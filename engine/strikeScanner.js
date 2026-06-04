const logger = require("../utils/logger");
const calculateRR = require("./payoffCalculator");

function findValidSpread(strikes, premiums, direction, atm) {
  let otmStrikes;

  // =====================
  // OTM FILTER
  // =====================
  if (direction === "BULLISH") {
    otmStrikes = strikes.filter((s) => s > atm);
  } else {
    otmStrikes = strikes.filter((s) => s < atm);
  }

  if (!otmStrikes.length) {
    logger.log("❌ No OTM strikes");
    return [];
  }

  // =====================
  // SORT BY ATM DISTANCE (CRITICAL FIX)
  // =====================
  otmStrikes.sort((a, b) => Math.abs(a - atm) - Math.abs(b - atm));

  // =====================
  // LIMIT BASED ON INDEX
  // =====================
  const maxStrikes = atm > 50000 ? 20 : 15; // BankNifty vs Nifty
  const range = otmStrikes.slice(0, maxStrikes);

  const MIN_RR = 1.8;
  const LOWER_RATIO = 0.45;
  const UPPER_RATIO = 0.55;
  const MIN_BUY_PREMIUM = 50;

  let validSpreads = [];

  // =====================
  // BUILD STRICT SPREADS
  // =====================
  for (let buyStrike of range) {
    const buyPremium = premiums[buyStrike];
    if (!buyPremium || buyPremium < MIN_BUY_PREMIUM) continue;

    let sellCandidates = range.filter((s) => {
      if (direction === "BULLISH") return s > buyStrike;
      else return s < buyStrike;
    });

    for (let sellStrike of sellCandidates) {
      const sellPremium = premiums[sellStrike];
      if (!sellPremium) continue;

      const ratio = sellPremium / buyPremium;

      // STRICT 50% RULE
      if (ratio < LOWER_RATIO || ratio > UPPER_RATIO) continue;

      const netPremium = buyPremium - sellPremium;
      if (netPremium <= 0) continue;

      const metrics = calculateRR(
        buyStrike,
        sellStrike,
        buyPremium,
        sellPremium
      );

      if (!metrics) continue;

      const rr = metrics.riskReward;

      // STRICT RR
      if (rr < MIN_RR) continue;

      validSpreads.push({
        buyStrike,
        sellStrike,
        buyPremium,
        sellPremium,
        netPremium,
        maxProfit: metrics.maxProfit,
        maxLoss: metrics.maxLoss,
        breakeven:
          direction === "BULLISH"
            ? buyStrike + netPremium
            : buyStrike - netPremium,
        rr,
        ratio,
        ratioScore: Math.abs(ratio - 0.5),
      });
    }
  }

  // =====================
  // NO TRADE CASE
  // =====================
  if (!validSpreads.length) {
    logger.log("❌ No valid spread found (STRICT RULES)");
    return [];
  }

  // =====================
  // PICK BEST
  // =====================
  validSpreads.sort((a, b) => {
    if (a.ratioScore !== b.ratioScore) {
      return a.ratioScore - b.ratioScore;
    }
    return b.rr - a.rr;
  });

  const bestSpread = validSpreads[0];


  return [bestSpread];
}

module.exports = findValidSpread;