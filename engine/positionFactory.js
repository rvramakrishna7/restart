const logger = require("../utils/logger");
const TOTAL_CAPITAL = 200000; // ₹2L
const RISK_PER_TRADE = 0.02; // 2%

function startBullCallSpread(manager, spread, strikes, premiums) {
  if (!spread || !strikes || !premiums) return null;

  const strikeStep = Math.abs(strikes[1] - strikes[0]);
  const index = spread.buyStrike > 50000 ? "BANKNIFTY" : "NIFTY";
  const buyStrike = spread.buyStrike;

  const premiumCurrent = premiums[buyStrike];
  if (!premiumCurrent) return null;

  const premium50 = premiums[buyStrike + 50] || 0;
  const premium100 = premiums[buyStrike + 100] || 0;
  const diff50 = premiumCurrent - premium50;
  const diff100 = premiumCurrent - premium100;

  const lotSize = spread.lotSize || 65;
  const maxLossPerLot = (spread.buyPremium - spread.sellPremium) * lotSize;
  if (maxLossPerLot <= 0) return null;

  const lots = spread.lots || 1;
  const quantity = lotSize * lots;

  const position = {
    type: "BULL_CALL",
    strategyType: "DEBIT_SPREAD",
    index,
    strikeStep,
    lotSize,
    lots,
    quantity,
    spreadWidth: Math.abs(spread.sellStrike - spread.buyStrike),
    maxLossPerLot,

    buyStrike: spread.buyStrike,
    sellStrike: spread.sellStrike,
    buyPremium: spread.buyPremium,
    sellPremium: spread.sellPremium,
    entryPremium: spread.buyAvgPrice || spread.buyPremium,

    // ── CRITICAL: initialize all adjustment state fields ──
    // these MUST be set here so they're persisted to DB from the start
    buyQty: quantity,
    sellQty: quantity,
    lossAdjusted: false,
    buyClosed: false,
    shiftCount: 0,
    forceExit: false,
    isStrangle: false,
    isActive: true,
    isClosed: false,
    mode: "paper", // will be overwritten by tradingService if live

    CE_sell: null, // populated only after strangle conversion
    PE_sell: null,
    basePremium: null,

    diff50,
    diff100,

    orderStatus: {
      buy: "PENDING",
      sell: "PENDING",
    },
    orderIds: {
      buy: null,
      sell: null,
    },
    originalMaxLoss: (spread.buyPremium - spread.sellPremium) * lotSize * (spread.lots || 1),
    currentLegEntryPrice: spread.buyAvgPrice || spread.buyPremium,
    realizedProfitFromShifts: 0,
    history: [],
  };

  if (manager) {
    manager.addPosition(position);
  }

  logger.log("\nBull Call Spread Triggered");
  return position;
}

function startBearPutSpread(manager, spread, strikes, premiums) {
  if (!spread || !strikes || !premiums) return null;

  const strikeStep = Math.abs(strikes[1] - strikes[0]);
  const index = spread.buyStrike > 50000 ? "BANKNIFTY" : "NIFTY";
  const buyStrike = spread.buyStrike;

  const premiumCurrent = premiums[buyStrike];
  if (!premiumCurrent) return null;

  const premium50 = premiums[buyStrike - 50] || 0;
  const premium100 = premiums[buyStrike - 100] || 0;
  const diff50 = premiumCurrent - premium50;
  const diff100 = premiumCurrent - premium100;

  const lotSize = spread.lotSize || 65;
  const maxLossPerLot = (spread.buyPremium - spread.sellPremium) * lotSize;
  if (maxLossPerLot <= 0) return null;

  const lots = spread.lots || 1;
  const quantity = lotSize * lots;

  const position = {
    type: "BEAR_PUT",
    strategyType: "DEBIT_SPREAD",
    index,
    strikeStep,
    lotSize,
    lots,
    quantity,
    spreadWidth: Math.abs(spread.sellStrike - spread.buyStrike),
    maxLossPerLot,

    buyStrike: spread.buyStrike,
    sellStrike: spread.sellStrike,
    buyPremium: spread.buyPremium,
    sellPremium: spread.sellPremium,
    entryPremium: spread.buyAvgPrice || spread.buyPremium,

    // ── CRITICAL: initialize all adjustment state fields ──
    buyQty: quantity,
    sellQty: quantity,
    lossAdjusted: false,
    buyClosed: false,
    shiftCount: 0,
    forceExit: false,
    isStrangle: false,
    isActive: true,
    isClosed: false,
    mode: "paper",

    CE_sell: null,
    PE_sell: null,
    basePremium: null,

    diff50,
    diff100,

    orderStatus: {
      buy: "PENDING",
      sell: "PENDING",
    },
    orderIds: {
      buy: null,
      sell: null,
    },
    originalMaxLoss: (spread.buyPremium - spread.sellPremium) * lotSize * (spread.lots || 1),
    currentLegEntryPrice: spread.buyAvgPrice || spread.buyPremium,
    realizedProfitFromShifts: 0,
    history: [],
  };

  if (manager) {
    manager.addPosition(position);
  }

  logger.log("\nBear Put Spread Triggered");
  return position;
}

module.exports = { startBullCallSpread, startBearPutSpread };