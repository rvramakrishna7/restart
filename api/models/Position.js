const mongoose = require("mongoose");

const PositionSchema = new mongoose.Schema(
  {
    // =====================
    // USER
    // =====================
    userId: String,

    // =====================
    // STRATEGY INFO
    // =====================
    index: String, // NIFTY / BANKNIFTY
    type: String, // BULL_CALL / BEAR_PUT
    strategyType: { type: String, default: "DEBIT_SPREAD" },
    expiry: String,
    mode: { type: String, default: "paper" }, // paper / live

    // =====================
    // STRIKES
    // =====================
    buyStrike: Number,
    sellStrike: Number,
    strikeStep: Number,

    // =====================
    // PREMIUMS
    // =====================
    buyPremium: Number,
    sellPremium: Number,
    entryPremium: Number,
    basePremium: Number,

    // =====================
    // SYMBOLS & TOKENS
    // =====================
    buySymbol: String,
    sellSymbol: String,
    buyToken: Number,
    sellToken: Number,
    token: String, // Zerodha access token (for restart)
    otmToken100: Number,
    otmToken50: Number,

    // =====================
    // QUANTITY
    // =====================
    lotSize: Number,
    lots: { type: Number, default: 1 },
    quantity: Number,

    // =====================
    // LEG QUANTITIES (tracks partial closes)
    // buyQty=0 means buy leg closed; sellQty=0 means sell leg closed
    // =====================
    buyQty: Number,
    sellQty: Number,

    // =====================
    // RISK
    // =====================
    maxLossPerLot: Number,
    spreadWidth: Number,
    margin: Number,
    diff50: Number,
    diff100: Number,
    originalMaxLoss: Number,
    currentLegEntryPrice: Number,
    realizedProfitFromShifts: { type: Number, default: 0 },

    // =====================
    // ORDER TRACKING
    // =====================
    orderIds: {
      buy: String,
      sell: String,
    },
    orderStatus: {
      buy: { type: String, default: "PENDING" },
      sell: { type: String, default: "PENDING" },
    },
    buyAvgPrice: Number,
    sellAvgPrice: Number,

    // =====================
    // LIVE PRICES (updated on each tick, persisted for restart)
    // =====================
    currentBuyPrice: Number,
    currentSellPrice: Number,
    pnl: { type: Number, default: 0 },

    // =====================
    // ADJUSTMENT STATE
    // Persisted so on server restart the engine doesn't re-trigger adjustments that already happened
    // =====================
    lossAdjusted: { type: Boolean, default: false },
    buyClosed: { type: Boolean, default: false },
    shiftCount: { type: Number, default: 0 },
    forceExit: { type: Boolean, default: false },

    // =====================
    // STRANGLE STATE
    // =====================
    isStrangle: { type: Boolean, default: false },

    CE_sell: {
      strike: Number,
      premium: Number,
      token: Number,
      openedAt: String,
      currentPrice: Number,
    },

    PE_sell: {
      strike: Number,
      premium: Number,
      token: Number,
      openedAt: String,
      currentPrice: Number,
    },

    // =====================
    // STATUS FLAGS
    // =====================
    isActive: { type: Boolean, default: true },
    isClosed: { type: Boolean, default: false },

    // =====================
    // ADJUSTMENT HISTORY (shown in UI spread table)
    // =====================
    // =====================
    // INTRADAY STRADDLE & STRANGLE STATE
    // All fields prefixed st_ to avoid collisions with debit spread fields
    // =====================
    st_futureToken: Number,
    st_entryFuturePrice: Number,
    st_refFuturePrice: Number,
    st_entryPremium: Number,
    st_realizedPnl: { type: Number, default: 0 },
    st_currentFuturePrice: Number,
    st_legs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    closedStrangleLegs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    closedBuyLegs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    closedBuyPrice: Number,
    closedSellPrice: Number,
    closedBuyAt: String,  

    // ── Iron fly fields ──
    if_ceSell: { type: mongoose.Schema.Types.Mixed, default: null },
    if_peSell: { type: mongoose.Schema.Types.Mixed, default: null },
    if_ceBuy: { type: mongoose.Schema.Types.Mixed, default: null },
    if_peBuy: { type: mongoose.Schema.Types.Mixed, default: null },
    if_bwLegs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    if_atmStrike: Number,
    if_netPremium: Number,
    if_upperBreakeven: Number,
    if_lowerBreakeven: Number,
    if_entryIV: Number,
    if_realizedLoss: { type: Number, default: 0 },
    if_rule1CeFired: { type: Boolean, default: false },
    if_rule1PeFired: { type: Boolean, default: false },
    if_bwActive: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Position", PositionSchema);