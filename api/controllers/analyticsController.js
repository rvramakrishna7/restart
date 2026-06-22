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
      stt += Math.max(1, (0.1 / 100) * exitTurnover);
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

const getNetPnl = (trade) => {
  const { brokerageAmt, otherCharges } = calcCharges(trade);
  const rawPnl = trade.totalPnl || trade.netPnl || 0;
  if ((trade.brokerage || 0) !== 0) return trade.netPnl || 0;
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
const avg = (arr) =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

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
      ? Number(
          (lossesArr.reduce((s, v) => s + v, 0) / lossesArr.length).toFixed(2),
        )
      : 0;
    const maxWin = winsArr.length ? Math.max(...winsArr) : 0;
    const maxLoss = lossesArr.length ? Math.min(...lossesArr) : 0;
    const grossPnl = Number(
      trades.reduce((s, t) => s + (t.totalPnl || 0), 0).toFixed(2),
    );
    const totalBrokerage = Number(
      trades.reduce((s, t) => s + calcCharges(t).brokerageAmt, 0).toFixed(2),
    );
    const totalCharges = Number(
      trades.reduce((s, t) => s + calcCharges(t).otherCharges, 0).toFixed(2),
    );
    const totalSlippage = Number(
      trades.reduce((s, t) => s + (t.slippage || 0), 0).toFixed(2),
    );
    // ROI — capital = unique strategies deployed × ₹2L (₹5L for Iron Fly)
    // Per period: unique strategy types × their margin = total capital for that period

    const getStrategyKey = (t) => {
      const s = (t.strategy || "").toUpperCase();
      if (s.includes("IRON")) return "IRON_FLY";
      if (s.includes("STRADDLE")) return "STRADDLE";
      if (s.includes("STRANGLE")) return "STRANGLE";
      if (s.includes("DEBIT") || s.includes("BULL") || s.includes("BEAR"))
        return "DEBIT_SPREAD";
      return s;
    };

    const capitalForStrategies = (tradesInPeriod) => {
      const seen = new Set(tradesInPeriod.map(getStrategyKey));
      let capital = 0;
      seen.forEach((s) => {
        capital += s === "IRON_FLY" ? 500000 : 200000;
      });
      return capital;
    };

    // Daily ROI
    const dayMap = {};
    trades.forEach((t, i) => {
      const key = dayKey(t.exitTime);
      if (!dayMap[key]) dayMap[key] = { pnl: 0, trades: [] };
      dayMap[key].pnl += netPnls[i];
      dayMap[key].trades.push(t);
    });

    // Weekly ROI
    const weekMap = {};
    trades.forEach((t, i) => {
      const key = weekKey(t.exitTime);
      if (!weekMap[key]) weekMap[key] = { pnl: 0, trades: [] };
      weekMap[key].pnl += netPnls[i];
      weekMap[key].trades.push(t);
    });

    // Monthly ROI
    const monMap = {};
    trades.forEach((t, i) => {
      const key = monthKey(t.exitTime);
      if (!monMap[key]) monMap[key] = { pnl: 0, trades: [] };
      monMap[key].pnl += netPnls[i];
      monMap[key].trades.push(t);
    });

    const roiOf = (map) =>
      Object.values(map).map((v) => {
        const capital = capitalForStrategies(v.trades);
        return capital ? Number(((v.pnl / capital) * 100).toFixed(2)) : 0;
      });

    const avgDailyRoi = Number(avg(roiOf(dayMap)).toFixed(2));
    const avgWeeklyRoi = Number(avg(roiOf(weekMap)).toFixed(2));
    const avgMonthlyRoi = Number(avg(roiOf(monMap)).toFixed(2));
    // ── New metrics ──
    const tradingDays = Object.keys(dayMap).length;
    const tradingMonths = Object.keys(monMap).length;

    const avgDayProfit = tradingDays
      ? Number((totalPnl / tradingDays).toFixed(2))
      : 0;
    const avgMonthlyProfit = tradingMonths
      ? Number((totalPnl / tradingMonths).toFixed(2))
      : 0;

    const lossRate = totalTrades
      ? Number(((lossesArr.length / totalTrades) * 100).toFixed(2))
      : 0;

    // Expectancy ratio: >1 means strategy makes more than it loses per trade
    const expectancy =
      avgWin && avgLoss && totalTrades
        ? Number(
            (
              (winsArr.length / totalTrades) * (avgWin / Math.abs(avgLoss)) -
              lossesArr.length / totalTrades
            ).toFixed(2),
          )
        : 0;

    // Deployed capital = unique strategies across entire filtered period
    const totalDeployedCapital = capitalForStrategies(trades);

    const totalStrategies = new Set(trades.map(getStrategyKey)).size;

    // Max Drawdown — using sorted daily cumulative PnL
    const sortedDays = Object.keys(dayMap).sort();
    let cumPnl = 0;
    let peak = -Infinity;
    let maxDrawdown = 0;
    let peakDay = null;
    let troughDay = null;
    let tempPeakDay = null;

    sortedDays.forEach((day) => {
      cumPnl += dayMap[day].pnl;
      if (cumPnl > peak) {
        peak = cumPnl;
        tempPeakDay = day;
      }
      const dd = cumPnl - peak;
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
        troughDay = day;
        peakDay = tempPeakDay;
      }
    });
    maxDrawdown = Number(maxDrawdown.toFixed(2));

    // MDD Recovery — days from trough day until cumulative PnL exceeds peak again
    let mddRecoveryDays = null;
    if (troughDay && maxDrawdown < 0) {
      let cum = 0;
      let counting = false;
      let dayCount = 0;
      for (const day of sortedDays) {
        cum += dayMap[day].pnl;
        if (day === troughDay) {
          counting = true;
          dayCount = 0;
        }
        if (counting) {
          dayCount++;
          if (cum >= peak) {
            mddRecoveryDays = dayCount;
            break;
          }
        }
      }
    }

    const returnToMddRatio =
      maxDrawdown < 0
        ? Number((totalPnl / Math.abs(maxDrawdown)).toFixed(2))
        : null;

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
        avgDayProfit,
        avgMonthlyProfit,
        lossRate,
        expectancy,
        totalDeployedCapital,
        totalStrategies,
        maxDrawdown,
        mddRecoveryDays,
        returnToMddRatio,
        grossPnl,
        totalBrokerage,
        totalCharges,
        totalSlippage,
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
      obj.slippageAmt = t.slippage || 0;
      obj.netPnlAfterCharges = netPnlAfterCharges;
      return obj;
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
