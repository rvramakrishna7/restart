const logger = require("../../utils/logger");
// =====================================================================
// INTRADAY STRADDLE — Adjustment Engine
// =====================================================================
// RULES:
//   Entry  : Sell ATM CE + PE. Store futures price as reference point.
//   Tiers  : Combined premium at entry decides move threshold (fixed all day).
//   Adjust : On threshold move — exit ITM leg, keep OTM, sell new leg.
//   Cycle  : Straddle -> Strangle -> Straddle -> ...
//   MaxLoss: lots x perLot (NIFTY 25pts / BANKNIFTY 50pts) ALL legs combined.
//   Expiry : Blocked at execution layer, not here.
// =====================================================================

const { STRADDLE } = require("../../config/constants");

// ── Get move threshold from combined entry premium ──
function getMoveThreshold(index, entryPremium) {
  const tiers = STRADDLE.ADJUSTMENT_TIERS[index];
  for (const tier of tiers) {
    if (entryPremium >= tier.minPremium) return tier.movePts;
  }
  return tiers[tiers.length - 1].movePts;
}

// ── Round futures UP to nearest 100 (ceiling) — for UP moves ──
function ceilToHundred(price) {
  return Math.ceil(price / 100) * 100;
}

// ── Round futures DOWN to nearest 100 (floor) — for DOWN moves ──
function floorToHundred(price) {
  return Math.floor(price / 100) * 100;
}

function getEntry(chain, strike) {
  return chain.find((o) => o.strike === strike) || null;
}

// ── Total PnL: realized from closed legs + unrealized from open legs ──
function calcTotalPnl(position) {
  let total = position.st_realizedPnl || 0;
  for (const leg of position.st_legs || []) {
    if (leg.closed) continue;
    const current =
      leg.currentPrice != null ? leg.currentPrice : leg.entryPremium;
    total += (leg.entryPremium - current) * (position.quantity || 1);
  }
  return Number(total.toFixed(2));
}

// =====================================================================
// MAIN — called every tick by strategyRouter
// =====================================================================
function evaluateStraddle(position, currentFuturePrice, _pnl, chain) {
  if (position._processing) return;
  position._processing = true;
  try {
    _evaluateStraddle(position, currentFuturePrice, _pnl, chain);
  } finally {
    position._processing = false;
  }
}

function _evaluateStraddle(position, currentFuturePrice, _pnl, chain) {
  if (!position || position.isClosed || position.forceExit) return;
  if (!Array.isArray(chain) || !chain.length) return;

  const futurePrice = currentFuturePrice || position.st_currentFuturePrice;
  if (!futurePrice || futurePrice <= 0) {
    logger.log("⏳ STRADDLE: futures price not available yet");
    return;
  }

  const index = position.index;
  const qty = position.quantity || 1;

  // ── MAX LOSS CHECK ──
  const maxLossPerLot = STRADDLE.MAX_LOSS_PER_LOT[index];
  const lots = position.lots || 1;
  const lotSize = position.lotSize || 1;
  const maxLossTotal = maxLossPerLot * lots * lotSize;

  const totalPnl = calcTotalPnl(position);
  position.pnl = totalPnl;

  if (totalPnl <= -maxLossTotal) {
    logger.log("MAX LOSS HIT STRADDLE:", totalPnl, "<=", -maxLossTotal);
    position.forceExit = true;
    position.history.push({
      type: "MAX_LOSS",
      message: `Max loss hit. PnL: ${totalPnl}`,
      time: new Date().toISOString(),
    });
    return;
  }

  // ── THRESHOLD CHECK ──
  const threshold = getMoveThreshold(index, position.st_entryPremium || 0);
  const refPrice = position.st_refFuturePrice;
  if (!refPrice) return;

  const move = futurePrice - refPrice;

  const now = Date.now();
  if (!position._lastLogTime || now - position._lastLogTime > 30000) {
    position._lastLogTime = now;
    const openCount = (position.st_legs || []).filter((l) => !l.closed).length;
    logger.log(
      `📊 STRADDLE [${index}] | spot: ${futurePrice} | ref: ${refPrice} | move: ${move.toFixed(1)} | threshold: ±${threshold} | legs: ${openCount} open | pnl: ${totalPnl}`,
    );
  }

  if (Math.abs(move) < threshold) return;
  // ── cooldown: skip if adjustment fired within last 3 seconds ──
  if (
    position._straddleAdjustedAt &&
    Date.now() - position._straddleAdjustedAt < 3000
  )
    return;
  // ── THRESHOLD HIT ──
  const movedUp = move > 0;
  const legs = position.st_legs || [];
  const open = legs.filter((l) => !l.closed);
  const ceLeg = open.find((l) => l.type === "CE");
  const peLeg = open.find((l) => l.type === "PE");

  logger.log(
    `THRESHOLD HIT — moved ${movedUp ? "UP" : "DOWN"} ${Math.abs(move).toFixed(1)}pts`,
  );

  if (open.length !== 2) {
    logger.log(
      "STRADDLE: expected 2 open legs, found",
      open.length,
      "- skipping",
    );
    return;
  }

  if (movedUp) {
    const isStraddle = ceLeg && peLeg && ceLeg.strike === peLeg.strike;

    if (ceLeg && peLeg && isStraddle) {
      
      // Exit CE, keep PE, sell new CE above futures
      _closeLeg(position, ceLeg, qty);

      let newStrike = ceilToHundred(futurePrice);
      if (newStrike === ceLeg.strike) newStrike += 100;
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "CE",
        newStrike,
        newEntry.CE,
        newEntry.CE_token,
        newEntry.CE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRADDLE->STRANGLE (UP): Closed CE ${ceLeg.strike}, Opened CE ${newStrike}`,
      );
      position.history.push({
        type: "STRADDLE_TO_STRANGLE",
        message: `Up ${Math.abs(move).toFixed(0)}pts. Exited CE ${ceLeg.strike}@${ceLeg.exitPrice}. New CE ${newStrike}@${newEntry.CE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    } else if (ceLeg && peLeg && !isStraddle) {
      // ── STRANGLE to STRADDLE: market up, CE is OTM (profit) ──
      // Close PE (losing), open new PE at CE strike
      _closeLeg(position, peLeg, qty);

      const openCE = legs.filter((l) => !l.closed).find((l) => l.type === "CE");
      const newStrike = openCE ? openCE.strike : ceilToHundred(futurePrice);
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "PE",
        newStrike,
        newEntry.PE,
        newEntry.PE_token,
        newEntry.PE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRANGLE->STRADDLE (UP): Closed PE ${peLeg.strike}, Opened PE ${newStrike}`,
      );
      position.history.push({
        type: "STRANGLE_TO_STRADDLE",
        message: `Up again. CE ${ceLeg.strike} is OTM. Exited PE ${peLeg.strike}@${peLeg.exitPrice}. New PE ${newStrike}@${newEntry.PE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    } else if (!ceLeg && peLeg) {
      // ── STRANGLE to STRADDLE: no CE open, close PE, open new PE at ATM ──
      _closeLeg(position, peLeg, qty);

      const openCE = legs.filter((l) => !l.closed).find((l) => l.type === "CE");
      const newStrike = openCE ? openCE.strike : ceilToHundred(futurePrice);
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "PE",
        newStrike,
        newEntry.PE,
        newEntry.PE_token,
        newEntry.PE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRANGLE->STRADDLE (UP): Closed PE ${peLeg.strike}, Opened PE ${newStrike}`,
      );
      position.history.push({
        type: "STRANGLE_TO_STRADDLE",
        message: `Up again. Exited PE ${peLeg.strike}@${peLeg.exitPrice}. New PE ${newStrike}@${newEntry.PE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    }
  } else {
    const isStraddle = ceLeg && peLeg && ceLeg.strike === peLeg.strike;

    if (ceLeg && peLeg && isStraddle) {
      // ── STRADDLE to STRANGLE: market down, PE is ITM (losing) ──
      // Exit PE, keep CE, sell new PE below futures
      _closeLeg(position, peLeg, qty);

      let newStrike = floorToHundred(futurePrice);
      if (newStrike === peLeg.strike) newStrike -= 100;
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "PE",
        newStrike,
        newEntry.PE,
        newEntry.PE_token,
        newEntry.PE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRADDLE->STRANGLE (DOWN): Closed PE ${peLeg.strike}, Opened PE ${newStrike}`,
      );
      position.history.push({
        type: "STRADDLE_TO_STRANGLE",
        message: `Down ${Math.abs(move).toFixed(0)}pts. Exited PE ${peLeg.strike}@${peLeg.exitPrice}. New PE ${newStrike}@${newEntry.PE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    } else if (ceLeg && peLeg && !isStraddle) {
      // ── STRANGLE to STRADDLE: market down, PE is OTM (profit) ──
      // Close CE (losing), open new CE at PE strike
      _closeLeg(position, ceLeg, qty);

      const openPE = legs.filter((l) => !l.closed).find((l) => l.type === "PE");
      const newStrike = openPE ? openPE.strike : floorToHundred(futurePrice);
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "CE",
        newStrike,
        newEntry.CE,
        newEntry.CE_token,
        newEntry.CE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRANGLE->STRADDLE (DOWN): Closed CE ${ceLeg.strike}, Opened CE ${newStrike}`,
      );
      position.history.push({
        type: "STRANGLE_TO_STRADDLE",
        message: `Down again. PE ${peLeg.strike} is OTM. Exited CE ${ceLeg.strike}@${ceLeg.exitPrice}. New CE ${newStrike}@${newEntry.CE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    } else if (ceLeg && !peLeg) {
      // ── STRANGLE to STRADDLE: no PE open, close CE, open new CE at ATM ──
      _closeLeg(position, ceLeg, qty);

      const openPE = legs.filter((l) => !l.closed).find((l) => l.type === "PE");
      const newStrike = openPE ? openPE.strike : floorToHundred(futurePrice);
      const newEntry = getEntry(chain, newStrike);
      if (!newEntry) {
        logger.log("No chain entry for", newStrike);
        return;
      }

      _openLeg(
        legs,
        "CE",
        newStrike,
        newEntry.CE,
        newEntry.CE_token,
        newEntry.CE_symbol,
        index,
      );
      position.st_refFuturePrice = futurePrice;

      logger.log(
        `STRANGLE->STRADDLE (DOWN): Closed CE ${ceLeg.strike}, Opened CE ${newStrike}`,
      );
      position.history.push({
        type: "STRANGLE_TO_STRADDLE",
        message: `Down again. Exited CE ${ceLeg.strike}@${ceLeg.exitPrice}. New CE ${newStrike}@${newEntry.CE}. Ref->${futurePrice}`,
        time: new Date().toISOString(),
      });
    }
  }
  position._straddleAdjustedAt = Date.now();
  position.st_legs = legs;
}

// ── Close a leg: mark it, store realized PnL ──
function _closeLeg(position, leg, qty) {
  const exitPrice =
    leg.currentPrice != null ? leg.currentPrice : leg.entryPremium;
  const realized = (leg.entryPremium - exitPrice) * qty;
  leg.closed = true;
  leg.exitPrice = exitPrice;
  leg.closedAt = new Date().toISOString();
  position.st_realizedPnl = (position.st_realizedPnl || 0) + realized;
}

// ── Open a new leg and push to legs array ──
function _openLeg(legs, type, strike, premium, token, symbol, index) {
  legs.push({
    type,
    strike,
    entryPremium: premium || 0,
    currentPrice: premium || 0,
    token: token,
    symbol: symbol || `${index}${strike}${type}`,
    closed: false,
    openedAt: new Date().toISOString(),
  });
}

module.exports = evaluateStraddle;