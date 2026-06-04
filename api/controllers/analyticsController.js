const Trade = require("../models/Trade");

// =====================
// SUMMARY API
// =====================
exports.getSummary = async (req, res) => {
  try {
    const userId = req.user; // from JWT, not client-supplied
    const { from, to, mode, strategy } = req.query;

    let filter = {
      userId,
      status: "CLOSED",
    };

    if (strategy && strategy !== "all") {
      filter.strategy = strategy;
    }

    if (from && to) {
      filter.exitTime = {
        $gte: new Date(from),
        $lte: new Date(to),
      };
    }

    const trades = await Trade.find(filter);

    const totalTrades = trades.length;

    const totalPnl = trades.reduce((sum, t) => sum + (t.netPnl || 0), 0);

    const winsArr = trades.filter((t) => (t.netPnl || 0) > 0);
    const lossesArr = trades.filter((t) => (t.netPnl || 0) < 0);

    const wins = winsArr.length;

    const winRate = totalTrades ? ((wins / totalTrades) * 100).toFixed(2) : 0;

    const avgWin = winsArr.length
      ? winsArr.reduce((s, t) => s + t.netPnl, 0) / winsArr.length
      : 0;

    const avgLoss = lossesArr.length
      ? lossesArr.reduce((s, t) => s + t.netPnl, 0) / lossesArr.length
      : 0;

    const maxWin = winsArr.length
      ? Math.max(...winsArr.map((t) => t.netPnl))
      : 0;

    const maxLoss = lossesArr.length
      ? Math.min(...lossesArr.map((t) => t.netPnl))
      : 0;

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
    const userId = req.user; // from JWT, not client-supplied
    const { from, to, mode, strategy } = req.query;

    let filter = {
      userId,
      status: "CLOSED",
    };

    if (strategy && strategy !== "all") {
      filter.strategy = strategy;
    }

    if (from && to) {
      filter.exitTime = {
        $gte: new Date(from),
        $lte: new Date(to),
      };
    }

    const trades = await Trade.find(filter);

    const map = {};

    trades.forEach((t) => {
      const date = new Date(t.exitTime).toLocaleDateString();

      if (!map[date]) map[date] = 0;

      map[date] += t.netPnl || 0;
    });

    const data = Object.keys(map).map((date) => ({
      date,
      pnl: map[date],
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
    const userId = req.user; // from JWT, not client-supplied
    const { from, to, mode, strategy } = req.query;

    let filter = {
      userId,
      status: "CLOSED",
    };

    if (strategy && strategy !== "all") {
      filter.strategy = strategy;
    }

    if (from && to) {
      filter.exitTime = {
        $gte: new Date(from),
        $lte: new Date(to),
      };
    }

    const trades = await Trade.find(filter);

    const map = {};

    trades.forEach((t) => {
      if (!map[t.strategy]) map[t.strategy] = 0;
      map[t.strategy] += t.netPnl || 0;
    });

    res.json({
      success: true,
      data: map,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET TRADE HISTORY
exports.getTradeHistory = async (req, res) => {
  try {
    const userId = req.user; // from JWT, not client-supplied
    const { from, to, mode, strategy } = req.query;

    let filter = {
      userId,
      status: "CLOSED",
    };

    if (strategy && strategy !== "all") {
      filter.strategy = strategy;
    }
    if (mode) {
      filter.mode = mode;
    }

    if (from && to) {
      filter.exitTime = {
        $gte: new Date(from),
        $lte: new Date(to),
      };
    }

    const trades = await Trade.find(filter).sort({ exitTime: -1 });

    res.json({
      success: true,
      data: trades,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
