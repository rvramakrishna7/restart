const logger = require("../../utils/logger");
const { sendAlert } = require("../../services/notify");
const money = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const signed = (n) => (n >= 0 ? "+" : "") + money(n);
// =====================================================================
// INTRADAY STRANGLE — Adjustment Engine
// =====================================================================
// RULES:
//   Entry  : Sell OTM CE + PE at equal premiums (e.g. 50 each).

//   Case 2 — 40% DECAY: If either leg decays 40% from entry premium
//            (e.g. PE: 50->30), book that profit leg (exit PE),
//            short new matching leg on opposite side at OTHER leg's current price.
//            e.g. PE decayed to 30, CE is now 60 -> exit PE, short new PE @ 60.
//   Max loss: defined later. Placeholder in constants (null = disabled).
// =====================================================================

const { STRANGLE } = require("../../config/constants");
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
function evaluateStrangle(position, currentFuturePrice, _pnl, chain) {
  if (position._processing) return;
  position._processing = true;
  try {
    _evaluateStrangle(position, currentFuturePrice, _pnl, chain);
  } finally {
    position._processing = false;
  }
}
function _evaluateStrangle(position, currentFuturePrice, _pnl, chain) {
  if (!position || position.isClosed || position.forceExit) return;
  if (!Array.isArray(chain) || !chain.length) return;

  const legs = position.st_legs || [];
  const open = legs.filter((l) => !l.closed);

  if (open.length !== 2) {
    logger.log(
      `⏳ STRANGLE: need 2 open legs, found ${open.length} — skipping`,
    );
    return;
  } 
  // need exactly 2 open legs to evaluate

  const ceLeg = open.find((l) => l.type === "CE");
  const peLeg = open.find((l) => l.type === "PE");
  if (!ceLeg || !peLeg) return;

  const qty = position.quantity || 1;

  // Get current live prices
  const ceCurrent =
    ceLeg.currentPrice != null ? ceLeg.currentPrice : ceLeg.entryPremium;
  const peCurrent =
    peLeg.currentPrice != null ? peLeg.currentPrice : peLeg.entryPremium;
  if (ceLeg.currentPrice == null || peLeg.currentPrice == null) {
    logger.log("⏳ STRANGLE: waiting for first live tick on legs");
    return;
  }
  // ── cooldown: skip if adjustment fired within last 3 seconds ──
  if (
    position._strangleAdjustedAt &&
    Date.now() - position._strangleAdjustedAt < 3000
  )
    return;
  // ── MAX LOSS CHECK (same rule as straddle: exit ALL legs) ──
  const maxLossPerLot = STRANGLE.MAX_LOSS_PER_LOT[position.index];
  const lots = position.lots || 1;
  const lotSize = position.lotSize || 1;
  const maxLossTotal = maxLossPerLot * lots * lotSize;

  const totalPnl = calcTotalPnl(position);
  position.pnl = totalPnl;

  if (totalPnl <= -maxLossTotal) {
    logger.log("MAX LOSS HIT STRANGLE:", totalPnl, "<=", -maxLossTotal);
    position.forceExit = true;
    position.history.push({
      type: "MAX_LOSS",
      message: `Max loss hit. PnL: ${totalPnl}`,
      time: new Date().toISOString(),
    });
    return;
  }
  const ceEntry = ceLeg.entryPremium;
  const peEntry = peLeg.entryPremium;

  const RISE = STRANGLE.RISE_TRIGGER_PCT;
  const DECAY = STRANGLE.DECAY_TRIGGER_PCT;

  // ── minimum distance from current futures price ──
  const isBnf = position.index === "BANKNIFTY";
  const minDist = isBnf ? 600 : 200;
  const futPrice = currentFuturePrice || position.st_currentFuturePrice || 0;
  const ceMinStrike = futPrice > 0 ? futPrice + minDist : null;
  const peMaxStrike = futPrice > 0 ? futPrice - minDist : null;

  const now = Date.now();
  if (!position._lastLogTime || now - position._lastLogTime > 30000) {
    position._lastLogTime = now;
    logger.log(
      `📊 STRANGLE [${position.index}] | CE: ${ceLeg.strike} entry: ${ceEntry} ltp: ${ceCurrent} (rise@${(ceEntry * (1 + RISE)).toFixed(1)} decay@${(ceEntry * (1 - DECAY)).toFixed(1)}) | PE: ${peLeg.strike} entry: ${peEntry} ltp: ${peCurrent} (rise@${(peEntry * (1 + RISE)).toFixed(1)} decay@${(peEntry * (1 - DECAY)).toFixed(1)}) | future: ${futPrice}`,
    );
  }

  // ── CASE 1: CE rose 50% ──
  // CE is problem leg — exit CE, keep PE open
  // Find new CE matching PE's current LTP
  if (ceCurrent >= ceEntry * (1 + RISE)) {
    logger.log(
      `STRANGLE: CE rose ${((ceCurrent / ceEntry - 1) * 100).toFixed(1)}% (${ceEntry}->${ceCurrent}). Exiting CE, finding new CE matching PE LTP ${peCurrent}.`,
    );

    // Find new CE strike matching PE's current LTP
    const targetPremium = peCurrent;
    const newCEEntry = findClosestByPremium(
      chain,
      "CE",
      targetPremium,
      ceMinStrike,
      null,
      ceLeg.strike,
    );
    if (!newCEEntry) {
      logger.log("STRANGLE: no CE match for premium", targetPremium);
      return;
    }

    // Exit CE (problem leg) — realized loss
    const ceExitPrice = ceCurrent;
    const ceRealized = (ceEntry - ceExitPrice) * qty;
    ceLeg.closed = true;
    ceLeg.exitPrice = ceExitPrice;
    ceLeg.closedAt = new Date().toISOString();
    position.st_realizedPnl = (position.st_realizedPnl || 0) + ceRealized;

    // Open new CE matching PE current LTP
    legs.push({
      type: "CE",
      strike: newCEEntry.strike,
      entryPremium: newCEEntry.CE,
      currentPrice: newCEEntry.CE,
      token: newCEEntry.CE_token,
      symbol: newCEEntry.CE_symbol || `${position.index}${newCEEntry.strike}CE`,
      closed: false,
      openedAt: new Date().toISOString(),
    });

    logger.log(
      `STRANGLE CASE1: CE rose. Closed CE ${ceLeg.strike}@${ceExitPrice}. New CE ${newCEEntry.strike}@${newCEEntry.CE} (matching PE LTP ${peCurrent}). PE ${peLeg.strike} stays open.`,
    );
    position.history.push({
      type: "STRANGLE_CE_RISE",
      message: `CE ${ceLeg.strike} rose to ${ceCurrent} (was ${ceEntry}). Exited CE@${ceExitPrice}. New CE ${newCEEntry.strike}@${newCEEntry.CE} matching PE LTP ${peCurrent}`,
      time: new Date().toISOString(),
    });
    try {
      const legPnl = (ceEntry - ceExitPrice) * qty;
      sendAlert(
        `🔄 STRANGLE ADJUSTMENT | ${position.index}\n` +
          `Reason: CE rose ${((ceCurrent / ceEntry - 1) * 100).toFixed(0)}% (${money(ceEntry)} → ${money(ceCurrent)})\n` +
          `Exited CE ${ceLeg.strike} @ ${money(ceExitPrice)} (${signed(legPnl)})\n` +
          `New CE ${newCEEntry.strike} @ ${money(newCEEntry.CE)} (matching PE LTP ${money(peCurrent)})\n` +
          `Net P&L: ${signed(position.st_realizedPnl)}`,
      );
    } catch (e) {}

    position._strangleAdjustedAt = Date.now();
    position.st_legs = legs;
    return;
  }

  // ── CASE 1: PE rose 50% ──
  // PE is problem leg — exit PE, keep CE open
  // Find new PE matching CE's current LTP
  if (peCurrent >= peEntry * (1 + RISE)) {
    logger.log(
      `STRANGLE: PE rose ${((peCurrent / peEntry - 1) * 100).toFixed(1)}% (${peEntry}->${peCurrent}). Exiting PE, finding new PE matching CE LTP ${ceCurrent}.`,
    );

    // Find new PE strike matching CE's current LTP
    const targetPremium = ceCurrent;
    const newPEEntry = findClosestByPremium(
      chain,
      "PE",
      targetPremium,
      null,
      peMaxStrike,
      peLeg.strike,
    );
    if (!newPEEntry) {
      logger.log("STRANGLE: no PE match for premium", targetPremium);
      return;
    }

    // Exit PE (problem leg) — realized loss
    const peExitPrice = peCurrent;
    const peRealized = (peEntry - peExitPrice) * qty;
    peLeg.closed = true;
    peLeg.exitPrice = peExitPrice;
    peLeg.closedAt = new Date().toISOString();
    position.st_realizedPnl = (position.st_realizedPnl || 0) + peRealized;

    // Open new PE matching CE current LTP
    legs.push({
      type: "PE",
      strike: newPEEntry.strike,
      entryPremium: newPEEntry.PE,
      currentPrice: newPEEntry.PE,
      token: newPEEntry.PE_token,
      symbol: newPEEntry.PE_symbol || `${position.index}${newPEEntry.strike}PE`,
      closed: false,
      openedAt: new Date().toISOString(),
    });

    logger.log(
      `STRANGLE CASE1: PE rose. Closed PE ${peLeg.strike}@${peExitPrice}. New PE ${newPEEntry.strike}@${newPEEntry.PE} (matching CE LTP ${ceCurrent}). CE ${ceLeg.strike} stays open.`,
    );
    position.history.push({
      type: "STRANGLE_PE_RISE",
      message: `PE ${peLeg.strike} rose to ${peCurrent} (was ${peEntry}). Exited PE@${peExitPrice}. New PE ${newPEEntry.strike}@${newPEEntry.PE} matching CE LTP ${ceCurrent}`,
      time: new Date().toISOString(),
    });
    try {
      const legPnl = (peEntry - peExitPrice) * qty;
      sendAlert(
        `🔄 STRANGLE ADJUSTMENT | ${position.index}\n` +
          `Reason: PE rose ${((peCurrent / peEntry - 1) * 100).toFixed(0)}% (${money(peEntry)} → ${money(peCurrent)})\n` +
          `Exited PE ${peLeg.strike} @ ${money(peExitPrice)} (${signed(legPnl)})\n` +
          `New PE ${newPEEntry.strike} @ ${money(newPEEntry.PE)} (matching CE LTP ${money(ceCurrent)})\n` +
          `Net P&L: ${signed(position.st_realizedPnl)}`,
      );
    } catch (e) {}

    position._strangleAdjustedAt = Date.now();
    position.st_legs = legs;
    return;
  }

  // ── CASE 2: PE decayed 40% ──
  // PE: 50 -> 30 (decayed 40%), CE: 50 -> 60
  // Exit PE (profit), short new PE matching CE current price (60)
  if (peCurrent <= peEntry * (1 - DECAY)) {
    logger.log(
      `STRANGLE: PE decayed ${((1 - peCurrent / peEntry) * 100).toFixed(1)}% (${peEntry}->${peCurrent}). Adjusting.`,
    );

    // Target = CE's current price (not decayed PE price)
    const targetPremium = ceCurrent;
    const newPEEntry = findClosestByPremium(
      chain,
      "PE",
      targetPremium,
      null,
      peMaxStrike,
      peLeg.strike,
    );
    if (!newPEEntry) {
      logger.log("STRANGLE: no PE match for premium", targetPremium);
      return;
    }

    const peExitPrice = peCurrent;
    const peRealized = (peEntry - peExitPrice) * qty;
    peLeg.closed = true;
    peLeg.exitPrice = peExitPrice;
    peLeg.closedAt = new Date().toISOString();
    position.st_realizedPnl = (position.st_realizedPnl || 0) + peRealized;

    legs.push({
      type: "PE",
      strike: newPEEntry.strike,
      entryPremium: newPEEntry.PE,
      currentPrice: newPEEntry.PE,
      token: newPEEntry.PE_token,
      symbol: newPEEntry.PE_symbol || `${position.index}${newPEEntry.strike}PE`,
      closed: false,
      openedAt: new Date().toISOString(),
    });

    logger.log(
      `STRANGLE CASE2: PE decayed. Closed PE ${peLeg.strike}@${peExitPrice}. New PE ${newPEEntry.strike}@${newPEEntry.PE} (matching CE ${ceCurrent})`,
    );
    position.history.push({
      type: "STRANGLE_PE_DECAY",
      message: `PE ${peLeg.strike} decayed to ${peCurrent} (was ${peEntry}). Closed. New PE ${newPEEntry.strike}@${newPEEntry.PE} matching CE ${ceCurrent}`,
      time: new Date().toISOString(),
    });

    try {
      const legPnl = (peEntry - peExitPrice) * qty;
      sendAlert(
        `🔄 STRANGLE ADJUSTMENT | ${position.index}\n` +
          `Reason: PE decayed ${((1 - peCurrent / peEntry) * 100).toFixed(0)}% (${money(peEntry)} → ${money(peCurrent)})\n` +
          `Booked PE ${peLeg.strike} @ ${money(peExitPrice)} (${signed(legPnl)})\n` +
          `New PE ${newPEEntry.strike} @ ${money(newPEEntry.PE)} (matching CE LTP ${money(ceCurrent)})\n` +
          `Net P&L: ${signed(position.st_realizedPnl)}`,
      );
    } catch (e) {}

    position._strangleAdjustedAt = Date.now();
    position.st_legs = legs;
    return;
  }

  // ── CASE 2: CE decayed 40% ──
  // CE: 50 -> 30 (decayed 40%), PE: 50 -> 60
  // Exit CE (profit), short new CE matching PE current price (60)
  if (ceCurrent <= ceEntry * (1 - DECAY)) {
    logger.log(
      `STRANGLE: CE decayed ${((1 - ceCurrent / ceEntry) * 100).toFixed(1)}% (${ceEntry}->${ceCurrent}). Adjusting.`,
    );

    const targetPremium = peCurrent;
    const newCEEntry = findClosestByPremium(
      chain,
      "CE",
      targetPremium,
      ceMinStrike,
      null,
      ceLeg.strike,
    );
    if (!newCEEntry) {
      logger.log("STRANGLE: no CE match for premium", targetPremium);
      return;
    }

    const ceExitPrice = ceCurrent;
    const ceRealized = (ceEntry - ceExitPrice) * qty;
    ceLeg.closed = true;
    ceLeg.exitPrice = ceExitPrice;
    ceLeg.closedAt = new Date().toISOString();
    position.st_realizedPnl = (position.st_realizedPnl || 0) + ceRealized;

    legs.push({
      type: "CE",
      strike: newCEEntry.strike,
      entryPremium: newCEEntry.CE,
      currentPrice: newCEEntry.CE,
      token: newCEEntry.CE_token,
      symbol: newCEEntry.CE_symbol || `${position.index}${newCEEntry.strike}CE`,
      closed: false,
      openedAt: new Date().toISOString(),
    });

    logger.log(
      `STRANGLE CASE2: CE decayed. Closed CE ${ceLeg.strike}@${ceExitPrice}. New CE ${newCEEntry.strike}@${newCEEntry.CE} (matching PE ${peCurrent})`,
    );
    position.history.push({
      type: "STRANGLE_CE_DECAY",
      message: `CE ${ceLeg.strike} decayed to ${ceCurrent} (was ${ceEntry}). Closed. New CE ${newCEEntry.strike}@${newCEEntry.CE} matching PE ${peCurrent}`,
      time: new Date().toISOString(),
    });

    try {
      const legPnl = (ceEntry - ceExitPrice) * qty;
      sendAlert(
        `🔄 STRANGLE ADJUSTMENT | ${position.index}\n` +
          `Reason: CE decayed ${((1 - ceCurrent / ceEntry) * 100).toFixed(0)}% (${money(ceEntry)} → ${money(ceCurrent)})\n` +
          `Booked CE ${ceLeg.strike} @ ${money(ceExitPrice)} (${signed(legPnl)})\n` +
          `New CE ${newCEEntry.strike} @ ${money(newCEEntry.CE)} (matching PE LTP ${money(peCurrent)})\n` +
          `Net P&L: ${signed(position.st_realizedPnl)}`,
      );
    } catch (e) {}

    position._strangleAdjustedAt = Date.now();
    position.st_legs = legs;
    return;
  }
}

// ── Find chain entry whose CE or PE premium is closest to target ──
// minStrike: for CE, only look at strikes >= minStrike
// maxStrike: for PE, only look at strikes <= maxStrike
function findClosestByPremium(
  chain,
  type,
  targetPremium,
  minStrike = null,
  maxStrike = null,
  excludeStrike = null,
) {
  let best = null;
  let bestDiff = Infinity;

  // ── filtered candidates beyond minimum distance ──
  const candidates = chain.filter((entry) => {
    if (excludeStrike !== null && entry.strike === excludeStrike) return false;
    if (type === "CE" && minStrike !== null && entry.strike < minStrike)
      return false;
    if (type === "PE" && maxStrike !== null && entry.strike > maxStrike)
      return false;
    const premium = type === "CE" ? entry.CE : entry.PE;
    const token = type === "CE" ? entry.CE_token : entry.PE_token;
    return premium && token;
  });

  // ── pass 1: find closest premium match ──
  for (const entry of candidates) {
    const premium = type === "CE" ? entry.CE : entry.PE;
    const diff = Math.abs(premium - targetPremium);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }

  if (best) return best;

  // ── pass 2: fallback — no premium match found, pick closest strike to boundary ──
  logger.log(
    `⚠️ STRANGLE: no premium match beyond min distance for ${type}. Using boundary fallback.`,
  );

  if (!candidates.length) return null;

  // for CE — pick strike closest to ceMinStrike (lowest valid CE strike)
  // for PE — pick strike closest to peMaxStrike (highest valid PE strike)
  if (type === "CE") {
    candidates.sort((a, b) => a.strike - b.strike);
  } else {
    candidates.sort((a, b) => b.strike - a.strike);
  }

  return candidates[0] || null;
}

module.exports = evaluateStrangle;
