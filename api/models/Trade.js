const mongoose = require("mongoose");

const LegSchema = new mongoose.Schema({
  symbol: String,
  type: String, // BUY / SELL
  qty: Number,

  entryPrice: Number,
  exitPrice: Number,

  pnl: {
    type: Number,
    default: 0,
  },

  status: {
    type: String,
    enum: ["OPEN", "CLOSED"],
    default: "OPEN",
  },

  entryTime: {
    type: Date,
    default: Date.now,
  },

  exitTime: Date,
});

const AdjustmentSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },

  reason: String,

  legsAdded: [LegSchema],
  legsClosed: [LegSchema],
});

const TradeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    strategy: String,
    instrument: String,

    // =====================
    // PRIMARY LEGS
    // =====================
    legs: [LegSchema],

    // =====================
    // ADJUSTMENTS (IMPORTANT)
    // =====================
    adjustments: [AdjustmentSchema],

    totalPnl: {
      type: Number,
      default: 0,
    },

    brokerage: {
      type: Number,
      default: 0,
    },

    // =====================
    // TIMING
    // =====================

    entryTime: Date,
    exitTime: Date,

    // =====================
    // FINANCIALS
    // =====================
    charges: {
      type: Number,
      default: 0,
    },

    netPnl: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN",
    },
    mode: {
      type: String,
      enum: ["paper", "live"],
      default: "live",
    },
    lots: { type: Number, default: 1 },
    strategyType: { type: String, default: "" },
    slippage: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Trade", TradeSchema);
