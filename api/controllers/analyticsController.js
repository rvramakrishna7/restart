const Trade = require("../models/Trade");

// =====================
// HELPERS
// =====================

// Recalculate brokerage + charges from stored legs
const calcCharges = (trade) => {
  const isIron =
    (trade.strategy || "").toUpperCase().includes("IRON") ||
    (trade.strategyType || "").toUpperCase().includes("IRON");

  // Iron Fly: untested — trust stored values
  if (isIron) {
    return {
      brokerageAmt: trade.brokerage || 0,
      otherCharges: trade.charges || 0,
    };
  }

  // Old trade already has correct charges saved — use them
  if ((trade.brokerage || 0) !== 0) {
    return {
      brokerageAmt: trade.brokerage || 0,
      otherCharges: trade.charges || 0,
    };
  }

  // Recalculate from legs for old trades with brokerage=0
  const legs = trade.legs || [];
  let brokerageAmt = 0;
  let stt = 0;
  let exchange = 0;
  let sebi = 0;
  let stamp = 0;

  for (const leg of legs) {
    const qty = Number(leg.qty || 0);
    const entry = Number(leg.entryPrice || 0);
    const exit = Number(leg.exitPrice || 0);
    const entryTurnover = entry * qty;
    const exitTurnover = exit * qty;

    brokerageAmt += 40; // ₹20 entry + ₹20 exit
    if (String(leg.type).startsWith("SELL")) {
      stt += (0.15 / 100) * exitTurnover;
    }
    exchange += (0.03553 / 100) * (entryTurnover + exitTurnover);
    sebi += (10 / 1e7) * (entryTurnover + exitTurnover);
    if (String(leg.type).startsWith("BUY")) {
      stamp += (0.003 / 100) * entryTurnover;
    }
  }

  const gst = 0.18 * (brokerageAmt + exchange + sebi);
  return {
    brokerageAmt: Number(brokerageAmt.toFixed(2)),
    otherCharges: Number((stt + exchange + sebi + gst + stamp).toFixed(2)),
  };
};

// Get deployed margin per trade
const getMargin = (trade) => {
  const isIron =
    (trade.strategy || "").toUpperCase().includes("IRON") ||
    (trade.strategyType || "").toUpperCase().includes("IRON");
  if (isIron) return 500000;
  return 200000 * (trade.lots || 1);
};

// Get net PnL after charges (recalculates for old trades)
const getNetPnl = (trade) => {
  const { brokerageAmt, otherCharges } = calcCharges(trade);
  const rawPnl = trade.totalPnl || trade.netPnl || 0;
  // If brokerage was already deducted (new trades), netPnl is correct
  if ((trade.brokerage || 0) !== 0) return trade.netPnl || 0;
  // Old trade: deduct recalculated charges from totalPnl
  return Number((rawPnl - brokerageAmt - otherCharges).toFixed(2));
};

// ISO week key: "2024-W23"
const weekKey = (d) => {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() + 3 - ((dt.getDay() + 6) % 7));
  const week1 = new Date(dt.getFullYear(), 0, 4);
  const wn = Math.round(((dt - week1) / 86400000 + 1) / 7);
  return `${dt.getFullYear()}-W${String(wn).padStart(2, "0")}`;
};

// Month key: "2024-06"
const monthKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

// Day key: "2024-06-15"
const dayKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// Average of an array
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// =====================
// SUMMARY API
// =====================
exports.getSummary = async (req, res) => {
  try {
    const userId = req.user;
    const { from, to, strategy } = req.query;

    let filter = { userId, status: "CLOSED" };
    if (strategy && strategy !== "all") filter.strategy = strategy;
    if (from && to) {
      filter.exitTime = { $gte: new Date(from), $lte: new Date(to) };
    }

    const trades = await Trade.find(filter);

    // Use net PnL after charges for all metrics
    const netPnls = trades.map((t) => getNetPnl(t));

    const totalTrades = trades.length;
    const totalPnl = Number(netPnls.reduce((s, v) => s + v, 0).toFixed(2));

    const winsArr = netPnls.filter((v) => v > 0);
    const lossesArr = netPnls.filter((v) => v < 0);

    const winRate = totalTrades
      ? ((winsArr.length / totalTrades) * 100).toFixed(2)
      : 0;
    const avgWin = winsArr.length
      ? Number((winsArr.reduce((s, v) => s + v, 0) / winsArr.length).toFixed(2))
      : 0;
    const avgLoss = lossesArr.length
      ? Number((lossesArr.reduce((s, v) => s + v, 0) / lossesArr.length).toFixed(2))
      : 0;
    const maxWin = winsArr.length ? Math.max(...winsArr) : 0;
    const maxLoss = lossesArr.length ? Math.min(...lossesArr) : 0;

    // ROI by day / week / month
    const dayMap = {};
    trades.forEach((t, i) => {
      const key = dayKey(t.exitTime);
      if (!dayMap[key]) dayMap[key] = { pnl: 0, capital: 0 };
      dayMap[key].pnl += netPnls[i];
      dayMap[key].capital += getMargin(t);
    });

    const weekMap = {};
    trades.forEach((t, i) => {
      const key = weekKey(t.exitTime);
      if (!weekMap[key]) weekMap[key] = { pnl: 0, capital: 0 };
      weekMap[key].pnl += netPnls[i];
      weekMap[key].capital += getMargin(t);
    });

    const monMap = {};
    trades.forEach((t, i) => {
      const key = monthKey(t.exitTime);
      if (!monMap[key]) monMap[key] = { pnl: 0, capital: 0 };
      monMap[key].pnl += netPnls[i];
      monMap[key].capital += getMargin(t);
    });

    const roiOf = (map) =>
      Object.values(map).map((v) =>
        v.capital ? Number(((v.pnl / v.capital) * 100).toFixed(2)) : 0
      );

    const avgDailyRoi = Number(avg(roiOf(dayMap)).toFixed(2));
    const avgWeeklyRoi = Number(avg(roiOf(weekMap)).toFixed(2));
    const avgMonthlyRoi = Number(avg(roiOf(monMap)).toFixed(2));

    res.json({
      success: true,
      data: {
        totalPnl,
        totalTrades,
        winRate,
        avgWin,
        avgLoss,
        maxWin,
        maxLoss,
        avgDailyRoi,
        avgWeeklyRoi,
        avgMonthlyRoi,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =====================
// DAILY PnL API
// =====================
exports.getDailyPnL = async (req, res) => {
  try {
    const userId = req.user;
    const { from, to, strategy } = req.query;

    let filter = { userId, status: "CLOSED" };
    if (strategy && strategy !== "all") filter.strategy = strategy;
    if (from && to) {
      filter.exitTime = { $gte: new Date(from), $lte: new Date(to) };
    }

    const trades = await Trade.find(filter);

    const map = {};
    trades.forEach((t) => {
      const key = dayKey(t.exitTime);
      if (!map[key]) map[key] = { pnl: 0, deployedCapital: 0 };
      map[key].pnl += getNetPnl(t);
      map[key].deployedCapital += getMargin(t);
    });

    const data = Object.keys(map).map((date) => ({
      date,
      pnl: Number(map[date].pnl.toFixed(2)),
      deployedCapital: map[date].deployedCapital,
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =====================
// STRATEGY PERFORMANCE
// =====================
exports.getStrategyPerformance = async (req, res) => {
  try {
    const userId = req.user;
    const { from, to, strategy } = req.query;

    let filter = { userId, status: "CLOSED" };
    if (strategy && strategy !== "all") filter.strategy = strategy;
    if (from && to) {
      filter.exitTime = { $gte: new Date(from), $lte: new Date(to) };
    }

    const trades = await Trade.find(filter);

    const map = {};
    trades.forEach((t) => {
      if (!map[t.strategy]) map[t.strategy] = 0;
      map[t.strategy] += getNetPnl(t);
    });

    res.json({ success: true, data: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =====================
// TRADE HISTORY
// =====================
exports.getTradeHistory = async (req, res) => {
  try {
    const userId = req.user;
    const { from, to, mode, strategy } = req.query;

    let filter = { userId, status: "CLOSED" };
    if (strategy && strategy !== "all") filter.strategy = strategy;
    if (mode) filter.mode = mode;
    if (from && to) {
      filter.exitTime = { $gte: new Date(from), $lte: new Date(to) };
    }

    const trades = await Trade.find(filter).sort({ exitTime: -1 });

    const data = trades.map((t) => {
      const { brokerageAmt, otherCharges } = calcCharges(t);
      const netPnlAfterCharges = getNetPnl(t);
      const obj = t.toObject();
      obj.brokerageAmt = brokerageAmt;
      obj.chargesAmt = otherCharges;
      obj.netPnlAfterCharges = netPnlAfterCharges;
      return obj;
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
