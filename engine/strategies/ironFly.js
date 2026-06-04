const logger = require("../../utils/logger");
// =====================================================================
// IRON FLY — Adjustment Engine
// =====================================================================
// RULES:
//   Entry  : Sell ATM CE + PE, Buy OTM CE + PE wings at ~20% of
//            combined premium distance. Entry at 3:20 PM on expiry day.
//   Rule 1 — ONE TIME PER SIDE:
// Market hits lower breakeven  exit PE buy wing  buy new
//            PE buy at lower breakeven strike.
// Market hits upper breakeven  exit CE buy wing  buy new
//            CE buy at upper breakeven strike.
//            Fires only if theoretical loss remains on that side (BS).
//   Rule 2 — SIMULTANEOUS with Rule 1, fires after Rule 1 completes:
//            Scan opposite wing inward toward ATM short (stop 1 strike
//            before ATM short). Find deepest consecutive chain where
//            each 100pt step satisfies 20% premium increase. Shift
//            directly to deepest valid strike in one trade.
//            Also fires on reversal to nullify remaining side loss.
//   Rule 3 — BROKEN WING FLY (fires after Rule 1):
//            Check 100pts inside breakeven strike.
// Get combined premium there  subtract 100  buy leg distance.
//            Short CE + PE at that strike.
//            Buy protection leg at (strike - distance) on threatened side.
//            Exit broken wing fly when market reverses to original ATM.
//            Fires only if theoretical loss remains on that side (BS).
// MAX LOSS: ₹2000 per lot realized  exit all legs immediately.
// =====================================================================

const { IRON_FLY } = require("../../config/constants");

// ── Normal CDF (Abramowitz & Stegun approximation) ──
function normCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// ── Black-Scholes theoretical price ──
function bsPrice(S, K, T, sigma, type) {
  if (T <= 0) return Math.max(type === "CE" ? S - K : K - S, 0);
  const r  = 0.065; // India risk-free rate ~6.5%
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "CE") {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  }
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

// ── Newton-Raphson IV solver ──
function calcIV(marketPrice, S, K, T, type) {
  if (T <= 0) return 0.2;
  let sigma = 0.2;
  for (let i = 0; i < 100; i++) {
    const price = bsPrice(S, K, T, sigma, type);
    const diff  = price - marketPrice;
    if (Math.abs(diff) < 0.001) break;
    const r  = 0.065;
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const vega = S * Math.sqrt(T) * Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
    if (vega < 1e-10) break;
    sigma -= diff / vega;
    if (sigma <= 0) sigma = 0.01;
  }
  return sigma;
}

// ── Time to expiry in years ──
function timeToExpiry(expiryStr) {
  const now    = new Date();
  const expiry = new Date(expiryStr);
  expiry.setHours(15, 30, 0, 0); // market close
  const diff = (expiry - now) / (1000 * 60 * 60 * 24 * 365);
  return Math.max(diff, 0);
}

// ── Calculate theoretical P&L for one side using BS ──
// Returns theoretical P&L of all legs on that side
// Positive = profit, Negative = loss
function theoreticalSidePnL(position, currentFutures, side) {
  const T     = timeToExpiry(position.expiry);
  const iv    = position.if_entryIV || 0.18;
  const qty   = position.quantity || 1;
  let   total = 0;

  if (side === "PE") {
    // PE sell leg — short, profit when premium falls
    const peSell = position.if_peSell;
    if (peSell) {
      const th  = bsPrice(currentFutures, peSell.strike, T, iv, "PE");
      total    += (peSell.entryPremium - th) * qty; // short = profit when th < entry
    }
    // PE buy leg (wing or shifted)
    const peBuy = position.if_peBuy;
    if (peBuy && !peBuy.closed) {
      const th  = bsPrice(currentFutures, peBuy.strike, T, iv, "PE");
      total    += (th - peBuy.entryPremium) * qty; // long = profit when th > entry
    }
    // broken wing PE legs
    if (position.if_bwActive && position.if_bwLegs) {
      for (const leg of position.if_bwLegs) {
        if (leg.closed) continue;
        const th = bsPrice(currentFutures, leg.strike, T, iv, leg.type);
        if (leg.isBuy) {
          total += (th - leg.entryPremium) * qty;
        } else {
          total += (leg.entryPremium - th) * qty;
        }
      }
    }
  }

  if (side === "CE") {
    // CE sell leg — short
    const ceSell = position.if_ceSell;
    if (ceSell) {
      const th  = bsPrice(currentFutures, ceSell.strike, T, iv, "CE");
      total    += (ceSell.entryPremium - th) * qty;
    }
    // CE buy leg (wing or shifted)
    const ceBuy = position.if_ceBuy;
    if (ceBuy && !ceBuy.closed) {
      const th  = bsPrice(currentFutures, ceBuy.strike, T, iv, "CE");
      total    += (th - ceBuy.entryPremium) * qty;
    }
  }

  return total;
}

// ── Rule 2: find deepest consecutive 20% chain and return target strike ──
function findRule2TargetStrike(chain, currentWingStrike, atmShortStrike, type, stepPts) {
  // scan inward from current wing toward ATM short
  // stop one strike before ATM short
  const boundary = type === "CE"
    ? atmShortStrike - stepPts  // CE side: stop at atmShort - step
    : atmShortStrike + stepPts; // PE side: stop at atmShort + step

  // get current wing premium
  const currentEntry = chain.find((o) => o.strike === currentWingStrike);
  if (!currentEntry) return null;

  let currentPremium = type === "CE" ? currentEntry.CE : currentEntry.PE;
  let currentStrike  = currentWingStrike;
  let deepestValid   = null;

  // walk inward step by step
  while (true) {
    const nextStrike = type === "CE"
      ? currentStrike - stepPts  // CE wing: move left toward ATM
      : currentStrike + stepPts; // PE wing: move right toward ATM

    // stop before ATM short leg
    if (type === "CE" && nextStrike <= boundary) break;
    if (type === "PE" && nextStrike >= boundary) break;

    const nextEntry = chain.find((o) => o.strike === nextStrike);
    if (!nextEntry) break;

    const nextPremium = type === "CE" ? nextEntry.CE : nextEntry.PE;
    if (!nextPremium) break;

    // 20% rule: next premium >= current * 1.20
    if (nextPremium >= currentPremium * 1.20) {
      deepestValid   = nextStrike;
      currentPremium = nextPremium;
      currentStrike  = nextStrike;
    } else {
      break; // chain broken — stop here
    }
  }

  return deepestValid; // null if no valid shift
}

// =====================================================================
// MAIN ENGINE
// =====================================================================
function evaluateIronFly(position, currentFutures, pnl, chain) {
  if (position._processing) return;
  position._processing = true;
  try {
    _evaluateIronFly(position, currentFutures, pnl, chain);
  } finally {
    position._processing = false;
  }
}

function _evaluateIronFly(position, currentFutures, pnl, chain) {
  if (!position || position.isClosed || position.forceExit) return;
  if (!Array.isArray(chain) || !chain.length) return;
  if (!currentFutures || currentFutures <= 0) return;

  const qty     = position.quantity || 1;
  const isBnf   = position.index === "BANKNIFTY";
  const stepPts = isBnf ? 100 : 50; // strike step for chain scanning

  // ── MAX LOSS EXIT: realized loss >= 2000 per lot ──
  const maxLossTotal = 2000 * (position.lots || 1);
  const realizedLoss = position.if_realizedLoss || 0;
  if (realizedLoss >= maxLossTotal) {
    logger.log(`❌ IRON FLY MAX LOSS HIT (₹${realizedLoss}) → EXIT ALL`);
    position.forceExit = true;
    return;
  }

  const upperBE = position.if_upperBreakeven;
  const lowerBE = position.if_lowerBreakeven;
  const atmStrike = position.if_atmStrike;

  if (!upperBE || !lowerBE || !atmStrike) return;
  // ── cooldown: skip if any adjustment fired within last 3 seconds ──
  if (position._ifAdjustedAt && Date.now() - position._ifAdjustedAt < 3000) return;
  // ── throttle logs to every 30 seconds ──
  const now = Date.now();
  if (!position._ifLastLog || now - position._ifLastLog > 30000) {
    position._ifLastLog = now;
    logger.log(
      `📊 IRON FLY | ${position.index} | fut: ${currentFutures} | ` +
      `CE short: ${position.if_ceSell?.strike} buy: ${position.if_ceBuy?.strike}(${position.if_ceBuy?.closed ? "closed" : "open"}) | ` +
      `PE short: ${position.if_peSell?.strike} buy: ${position.if_peBuy?.strike}(${position.if_peBuy?.closed ? "closed" : "open"}) | ` +
      `upBE: ${upperBE} (${(upperBE - currentFutures).toFixed(0)} away) | ` +
      `loBE: ${lowerBE} (${(currentFutures - lowerBE).toFixed(0)} away) | ` +
      `R1ce:${position.if_rule1CeFired ? "✓" : "✗"} R1pe:${position.if_rule1PeFired ? "✓" : "✗"} BW:${position.if_bwActive ? "✓" : "✗"} | ` +
      `realLoss: ₹${realizedLoss}`
    );
  }

  // =====================================================================
  // RULE 2 — runs independently at any time on both sides
  // Check CE buy wing — scan inward toward ATM CE short
  // =====================================================================
  const ceBuy = position.if_ceBuy;
  if (ceBuy && !ceBuy.closed) {
    const targetCE = findRule2TargetStrike(
      chain, ceBuy.strike, position.if_ceSell.strike, "CE", stepPts
    );
    if (targetCE && targetCE !== ceBuy.strike) {
      const targetEntry = chain.find((o) => o.strike === targetCE);
      if (targetEntry && targetEntry.CE_token) {
        logger.log(`🔄 IRON FLY RULE2: CE wing shift ${ceBuy.strike} → ${targetCE}`);
        const exitPremium   = ceBuy.currentPrice || ceBuy.entryPremium;
        const entryPremium  = targetEntry.CE;
        // realized from closing old wing
        const legRealized   = (exitPremium - ceBuy.entryPremium) * qty; // long leg closed
        position.if_realizedLoss = Math.max(0, (position.if_realizedLoss || 0) - legRealized);
        position.if_ceBuy = {
          strike:       targetCE,
          entryPremium: entryPremium,
          currentPrice: entryPremium,
          token:        Number(targetEntry.CE_token),
          closed:       false,
        };
        position._ifAdjustedAt = Date.now();
        position.history.push({
          type:    "IRON_FLY_RULE2_CE",
          message: `CE wing shifted ${ceBuy.strike} → ${targetCE} via 20% rule`,
          time:    new Date().toISOString(),
        });
      }
    }
  }

  // Check PE buy wing — scan inward toward ATM PE short
  const peBuy = position.if_peBuy;
  if (peBuy && !peBuy.closed) {
    const targetPE = findRule2TargetStrike(
      chain, peBuy.strike, position.if_peSell.strike, "PE", stepPts
    );
    if (targetPE && targetPE !== peBuy.strike) {
      const targetEntry = chain.find((o) => o.strike === targetPE);
      if (targetEntry && targetEntry.PE_token) {
        logger.log(`🔄 IRON FLY RULE2: PE wing shift ${peBuy.strike} → ${targetPE}`);
        const exitPremium  = peBuy.currentPrice || peBuy.entryPremium;
        const entryPremium = targetEntry.PE;
        const legRealized  = (exitPremium - peBuy.entryPremium) * qty;
        position.if_realizedLoss = Math.max(0, (position.if_realizedLoss || 0) - legRealized);
        position.if_peBuy = {
          strike:       targetPE,
          entryPremium: entryPremium,
          currentPrice: entryPremium,
          token:        Number(targetEntry.PE_token),
          closed:       false,
        };
        position._ifAdjustedAt = Date.now();
        position.history.push({
          type:    "IRON_FLY_RULE2_PE",
          message: `PE wing shifted ${peBuy.strike} → ${targetPE} via 20% rule`,
          time:    new Date().toISOString(),
        });
      }
    }
  }

  // =====================================================================
  // BROKEN WING FLY EXIT — market reverses to original ATM
  // =====================================================================
  if (
    position.if_bwActive &&
    position.if_bwLegs?.length &&
    Math.abs(currentFutures - atmStrike) <= stepPts
  ) {
    logger.log(`🔄 IRON FLY: market at ATM ${atmStrike} → exiting broken wing fly`);
    for (const leg of position.if_bwLegs) {
      if (leg.closed) continue;
      const exitEntry = chain.find((o) => o.strike === leg.strike);
      const exitPrice = exitEntry
        ? (leg.type === "CE" ? exitEntry.CE : exitEntry.PE)
        : leg.entryPremium;
      // realize P&L for each bw leg
      if (leg.isBuy) {
        const realized = (exitPrice - leg.entryPremium) * qty;
        if (realized < 0) position.if_realizedLoss = (position.if_realizedLoss || 0) + Math.abs(realized);
      } else {
        const realized = (leg.entryPremium - exitPrice) * qty;
        if (realized < 0) position.if_realizedLoss = (position.if_realizedLoss || 0) + Math.abs(realized);
      }
      leg.closed    = true;
      leg.exitPrice = exitPrice;
      leg.closedAt  = new Date().toISOString();
    }
    position.if_bwActive = false;
    position._ifAdjustedAt = Date.now();
    position.history.push({
      type:    "IRON_FLY_BW_EXIT",
      message: `Broken wing fly exited — market reversed to ATM ${atmStrike}`,
      time:    new Date().toISOString(),
    });
    return;
  }

  // =====================================================================
  // RULE 1 — lower breakeven hit (PE side)
  // =====================================================================
  if (!position.if_rule1PeFired && currentFutures <= lowerBE) {
    // check if theoretical loss still exists on PE side
    const peSidePnL = theoreticalSidePnL(position, currentFutures, "PE");
    if (peSidePnL >= 0) {
      logger.log(`✅ IRON FLY: no PE side loss (BS pnl: ${peSidePnL.toFixed(0)}) → skip Rule1+3`);
    } else {
      logger.log(`⚠️ IRON FLY RULE1: lower BE ${lowerBE} hit | futures: ${currentFutures} | PE loss: ₹${peSidePnL.toFixed(0)}`);

      // exit current PE buy wing
      const oldPeBuy  = position.if_peBuy;
      if (oldPeBuy && !oldPeBuy.closed) {
        const exitPrice = oldPeBuy.currentPrice || oldPeBuy.entryPremium;
        const realized  = (exitPrice - oldPeBuy.entryPremium) * qty; // long leg
        if (realized < 0) position.if_realizedLoss = (position.if_realizedLoss || 0) + Math.abs(realized);
        oldPeBuy.closed    = true;
        oldPeBuy.exitPrice = exitPrice;
        oldPeBuy.closedAt  = new Date().toISOString();
      }

      // buy new PE at lower breakeven strike
      const newPeEntry = chain.find((o) => o.strike === lowerBE);
      if (newPeEntry && newPeEntry.PE_token) {
        position.if_peBuy = {
          strike:       lowerBE,
          entryPremium: newPeEntry.PE,
          currentPrice: newPeEntry.PE,
          token:        Number(newPeEntry.PE_token),
          closed:       false,
        };
        logger.log(`✅ IRON FLY RULE1: new PE buy at ${lowerBE} @ ${newPeEntry.PE}`);
      }

      position.if_rule1PeFired = true;
      position._ifAdjustedAt = Date.now();
      position.history.push({
        type:    "IRON_FLY_RULE1_PE",
        message: `Lower BE ${lowerBE} hit. PE wing moved from ${oldPeBuy?.strike} → ${lowerBE}`,
        time:    new Date().toISOString(),
      });

      // ── RULE 3: broken wing fly on PE side ──
      if (!position.if_bwActive) {
        const bwStrike = lowerBE + stepPts * 2; // 100pts inside breakeven
        const bwEntry  = chain.find((o) => o.strike === bwStrike);
        if (bwEntry && bwEntry.CE && bwEntry.PE) {
          const combinedBW   = (bwEntry.CE || 0) + (bwEntry.PE || 0);
          const buyLegDist   = combinedBW - 100; // subtract 100
          const buyLegStrike = Math.round((bwStrike - buyLegDist) / stepPts) * stepPts;
          const buyLegEntry  = chain.find((o) => o.strike === buyLegStrike);

          if (buyLegEntry && buyLegEntry.PE_token && combinedBW > 100) {
            position.if_bwActive = true;
            position.if_bwLegs   = [
              {
                type:         "CE",
                strike:       bwStrike,
                entryPremium: bwEntry.CE,
                currentPrice: bwEntry.CE,
                token:        Number(bwEntry.CE_token),
                isBuy:        false,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
              {
                type:         "PE",
                strike:       bwStrike,
                entryPremium: bwEntry.PE,
                currentPrice: bwEntry.PE,
                token:        Number(bwEntry.PE_token),
                isBuy:        false,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
              {
                type:         "PE",
                strike:       buyLegStrike,
                entryPremium: buyLegEntry.PE,
                currentPrice: buyLegEntry.PE,
                token:        Number(buyLegEntry.PE_token),
                isBuy:        true,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
            ];
            logger.log(`✅ IRON FLY RULE3: BW fly created | short ${bwStrike} CE+PE | buy ${buyLegStrike} PE | combined: ${combinedBW}`);
            position.history.push({
              type:    "IRON_FLY_RULE3_PE",
              message: `Broken wing fly created at ${bwStrike}. Buy leg: ${buyLegStrike} PE`,
              time:    new Date().toISOString(),
            });
          }
        }
      }
    }
    return;
  }

  // =====================================================================
  // RULE 1 — upper breakeven hit (CE side)
  // =====================================================================
  if (!position.if_rule1CeFired && currentFutures >= upperBE) {
    // check if theoretical loss still exists on CE side
    const ceSidePnL = theoreticalSidePnL(position, currentFutures, "CE");
    if (ceSidePnL >= 0) {
      logger.log(`✅ IRON FLY: no CE side loss (BS pnl: ${ceSidePnL.toFixed(0)}) → skip Rule1+3`);
    } else {
      logger.log(`⚠️ IRON FLY RULE1: upper BE ${upperBE} hit | futures: ${currentFutures} | CE loss: ₹${ceSidePnL.toFixed(0)}`);

      // exit current CE buy wing
      const oldCeBuy  = position.if_ceBuy;
      if (oldCeBuy && !oldCeBuy.closed) {
        const exitPrice = oldCeBuy.currentPrice || oldCeBuy.entryPremium;
        const realized  = (exitPrice - oldCeBuy.entryPremium) * qty;
        if (realized < 0) position.if_realizedLoss = (position.if_realizedLoss || 0) + Math.abs(realized);
        oldCeBuy.closed    = true;
        oldCeBuy.exitPrice = exitPrice;
        oldCeBuy.closedAt  = new Date().toISOString();
      }

      // buy new CE at upper breakeven strike
      const newCeEntry = chain.find((o) => o.strike === upperBE);
      if (newCeEntry && newCeEntry.CE_token) {
        position.if_ceBuy = {
          strike:       upperBE,
          entryPremium: newCeEntry.CE,
          currentPrice: newCeEntry.CE,
          token:        Number(newCeEntry.CE_token),
          closed:       false,
        };
        logger.log(`✅ IRON FLY RULE1: new CE buy at ${upperBE} @ ${newCeEntry.CE}`);
      }

      position.if_rule1CeFired = true;
      position._ifAdjustedAt = Date.now();
      position.history.push({
        type:    "IRON_FLY_RULE1_CE",
        message: `Upper BE ${upperBE} hit. CE wing moved from ${oldCeBuy?.strike} → ${upperBE}`,
        time:    new Date().toISOString(),
      });

      // ── RULE 3: broken wing fly on CE side ──
      if (!position.if_bwActive) {
        const bwStrike = upperBE - stepPts * 2; // 100pts inside breakeven
        const bwEntry  = chain.find((o) => o.strike === bwStrike);
        if (bwEntry && bwEntry.CE && bwEntry.PE) {
          const combinedBW   = (bwEntry.CE || 0) + (bwEntry.PE || 0);
          const buyLegDist   = combinedBW - 100;
          const buyLegStrike = Math.round((bwStrike + buyLegDist) / stepPts) * stepPts;
          const buyLegEntry  = chain.find((o) => o.strike === buyLegStrike);

          if (buyLegEntry && buyLegEntry.CE_token && combinedBW > 100) {
            position.if_bwActive = true;
            position.if_bwLegs   = [
              {
                type:         "CE",
                strike:       bwStrike,
                entryPremium: bwEntry.CE,
                currentPrice: bwEntry.CE,
                token:        Number(bwEntry.CE_token),
                isBuy:        false,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
              {
                type:         "PE",
                strike:       bwStrike,
                entryPremium: bwEntry.PE,
                currentPrice: bwEntry.PE,
                token:        Number(bwEntry.PE_token),
                isBuy:        false,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
              {
                type:         "CE",
                strike:       buyLegStrike,
                entryPremium: buyLegEntry.CE,
                currentPrice: buyLegEntry.CE,
                token:        Number(buyLegEntry.CE_token),
                isBuy:        true,
                closed:       false,
                openedAt:     new Date().toISOString(),
              },
            ];
            logger.log(`✅ IRON FLY RULE3: BW fly created | short ${bwStrike} CE+PE | buy ${buyLegStrike} CE | combined: ${combinedBW}`);
            position.history.push({
              type:    "IRON_FLY_RULE3_CE",
              message: `Broken wing fly created at ${bwStrike}. Buy leg: ${buyLegStrike} CE`,
              time:    new Date().toISOString(),
            });
          }
        }
      }
    }
    return;
  }
}

module.exports = evaluateIronFly;