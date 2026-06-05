const logger = require("../../utils/logger");
const tradingService = require("../../services/tradingService");
const User = require("../models/User");
const Trade = require("../models/Trade");
const PositionModel = require("../models/Position");
const { buildSymbol } = require("../../services/symbolService");
const zerodhaService = require("../../services/zerodhaService");
const { getTickMap } = require("../../services/strategyControllerBridge");

// =====================
// FORMAT EXPIRY
// =====================
const formatExpiry = (isoDate) => {
  const d = new Date(isoDate);
  return d.toISOString().split("T")[0];
};

// ── points: favorable difference. SELL: entry - current. BUY: current - entry ──
const calcPoints = (entry, current, isBuy) => {
  const e = Number(entry) || 0;
  const c = Number(current) || 0;
  const pts = isBuy ? c - e : e - c;
  return Number(pts.toFixed(2));
};

// =====================
// EXECUTE STRATEGY
// =====================
exports.executeStrategy = async (req, res) => {
  try {
    const { instrument, expiry, direction, lots, mode } = req.body || {};

    if (!instrument || !direction) {
      return res.status(400).json({
        success: false,
        message: "instrument and direction are required",
      });
    }

    const user = await User.findById(req.user);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    if (!user?.broker?.connected || !user?.broker?.accessToken) {
      return res.status(400).json({
        success: false,
        message: "Broker not connected. Please connect Zerodha first.",
      });
    }

    // format expiry
    let formattedExpiry = null;
    if (expiry?.date) formattedExpiry = formatExpiry(expiry.date);
    else if (typeof expiry === "string") formattedExpiry = expiry;
    else
      return res
        .status(400)
        .json({ success: false, message: "Expiry is required" });

    // save strategy config
    await User.findByIdAndUpdate(req.user, {
      strategy: {
        name: "Debit Spread",
        config: { instrument, expiry: formattedExpiry, direction },
      },
    });

    let result;
    try {
      result = await tradingService.executeStrategy({
        instrument,
        expiry: formattedExpiry,
        direction,
        userId: req.user,
        lots: lots || 1,
        preview: false,
        mode: mode || "live",
      });
    } catch (err) {
      logger.error("ENGINE ERROR:", err.message);
      return res.status(500).json({
        success: false,
        message: err.message || "Strategy execution failed",
      });
    }

    if (result?.message === "Market closed") {
      return res.json({
        success: true,
        message: "Market closed — no trade executed",
        data: result,
      });
    }

    // adjustment engine runs via positionManager.handleTicks  updatePremium on every tick

    // save trade record
    try {
      const spread = result?.spread;
      if (spread && spread.buyStrike && spread.sellStrike) {
        const type = direction === "BULLISH" ? "CE" : "PE";
        const buySymbol = buildSymbol({
          instrument,
          strike: spread.buyStrike,
          type,
          expiry: formattedExpiry,
        });
        const sellSymbol = buildSymbol({
          instrument,
          strike: spread.sellStrike,
          type,
          expiry: formattedExpiry,
        });
        const qty = spread.quantity || spread.qty || 0;

        await Trade.create({
          userId: req.user,
          strategy: "Debit Spread",
          instrument,
          mode: mode || "live",
          legs: [
            {
              symbol: buySymbol,
              type: "BUY",
              qty,
              entryPrice: spread.buyPremium,
            },
            {
              symbol: sellSymbol,
              type: "SELL",
              qty,
              entryPrice: spread.sellPremium,
            },
          ],
        });
      }
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// =====================
// EXIT ALL
// =====================
exports.exitAll = async (req, res) => {
  try {
    const mode = req.query.mode || "live";

    if (mode === "paper") {
      const filterType = req.query.strategyType;
      let positions = tradingService.getPositions();

      // ── only exit positions of this strategy type ──
      if (filterType) {
        if (filterType === "DEBIT_SPREAD") {
          positions = positions.filter(
            (p) =>
              p.strategyType !== "INTRADAY_STRADDLE" &&
              p.strategyType !== "INTRADAY_STRANGLE" &&
              p.strategyType !== "IRON_FLY",
          );
        } else {
          positions = positions.filter((p) => p.strategyType === filterType);
        }
      }
      const mgr = require("../../managers/positionManagerInstance");
      for (const p of positions) {
        await mgr.recordClosedTrade(p, "EXIT_ALL");
        p.buyQty = 0;
        p.sellQty = 0;
        p.isClosed = true;
        p.isActive = false;
        if (p._id)
          await PositionModel.findByIdAndUpdate(p._id, {
            isClosed: true,
            isActive: false,
          });
      }
      // ── purge all closed positions from in-memory array ──
      
      mgr.positions = mgr.positions.filter((p) => !p.isClosed);
      logger.log(
        `🧹 Exit All: memory cleared, ${mgr.positions.length} position(s) remain`,
      );

      return res.json({ success: true });
    }

    const user = await User.findById(req.user);
    if (!user?.broker?.accessToken)
      return res
        .status(400)
        .json({ success: false, message: "Broker not connected" });

    const token = user.broker.accessToken;
    const positions = await zerodhaService.getPositions(token);
    const netPositions = positions?.net || [];

    for (const p of netPositions) {
      if (p.quantity === 0) continue;
      await zerodhaService.placeOrder(token, {
        tradingsymbol: p.tradingsymbol,
        exchange: p.exchange,
        transaction_type: p.quantity > 0 ? "SELL" : "BUY",
        order_type: "MARKET",
        quantity: Math.abs(p.quantity),
        product: p.product,
        validity: "DAY",
      });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error("EXIT ERROR:", err.message);
    res.status(500).json({ success: false, message: "Exit failed" });
  }
};

// =====================
// ENGINE EVENTS (safe, user-facing) — for toasts + activity timeline
// Reads position.history[] and maps internal types to friendly messages.
// Never exposes thresholds, strikes, or strategy parameters.
// =====================
const EVENT_LABELS = {
  STRADDLE_TO_STRANGLE: "Position adjusted — converted to strangle",
  STRANGLE_TO_STRADDLE: "Position adjusted — rebalanced",
  MAX_LOSS: "Risk limit reached — position closed",
  TARGET: "Target reached — position closed",
};

exports.getEngineEvents = async (req, res) => {
  try {
    const positions = tradingService.getPositions();
    const events = [];

    for (const p of positions) {
      for (const h of p.history || []) {
        events.push({
          time: h.time || h.timestamp || null,
          type: h.type || h.action || "EVENT",
          message: EVENT_LABELS[h.type] || "Position adjusted",
          instrument: p.index,
          strategyType: p.strategyType,
        });
      }
    }

    // newest first, cap to last 50
    events.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({ success: true, data: events.slice(0, 50) });
  } catch (err) {
    logger.error("getEngineEvents error:", err.message);
    res.json({ success: true, data: [] });
  }
};

// =====================
// REAL POSITIONS
// =====================
exports.getRealPositions = async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user?.broker?.accessToken)
      return res.json({ success: true, data: [] });

    const token = user.broker.accessToken;
    const positions = await zerodhaService.getPositions(token);
    const active = (positions?.net || []).filter((p) => p.quantity !== 0);
    if (!active.length) return res.json({ success: true, data: [] });

    const symbols = active.map((p) => `NFO:${p.tradingsymbol}`);
    const ltpData = await zerodhaService.getLTP(token, symbols);

    const formatted = active.map((p) => {
      const ltp =
        ltpData[`NFO:${p.tradingsymbol}`]?.last_price || p.last_price || 0;
      const pnl = (ltp - p.average_price) * p.quantity;
      return {
        symbol: p.tradingsymbol,
        qty: p.quantity,
        avgPrice: Number(p.average_price.toFixed(2)),
        ltp: Number(ltp.toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
      };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    if (!global._positionErrorLogged) {
      global._positionErrorLogged = true;
      logger.log("⚠️ Broker not connected — positions unavailable");
    }
    res.json({ success: true, data: [] });
  }
};

// =====================
// MARKET DATA
// =====================
exports.getMarketData = async (req, res) => {
  try {
    const user = await User.findById(req.user);
    const token = user?.broker?.accessToken;
    if (!token) return res.json({ success: true, data: null });

    const quote = await zerodhaService.getLTP(token, [
      "NSE:NIFTY 50",
      "NSE:NIFTY BANK",
    ]);
    const nifty = quote["NSE:NIFTY 50"];
    const bank = quote["NSE:NIFTY BANK"];

    res.json({
      success: true,
      data: {
        nifty: {
          price: nifty?.last_price || 0,
          change: nifty?.net_change || 0,
          changePercent: nifty?.ohlc?.close
            ? (
                ((nifty.last_price - nifty.ohlc.close) / nifty.ohlc.close) *
                100
              ).toFixed(2)
            : 0,
        },
        banknifty: {
          price: bank?.last_price || 0,
          change: bank?.net_change || 0,
          changePercent: bank?.ohlc?.close
            ? (
                ((bank.last_price - bank.ohlc.close) / bank.ohlc.close) *
                100
              ).toFixed(2)
            : 0,
        },
        marketStatus: getMarketStatus(),
      },
    });
  } catch (err) {
    if (!global._marketErrorLogged) {
      global._marketErrorLogged = true;
      logger.log("⚠️ Market data unavailable — broker not connected ");
    }
    res.json({ success: true, data: null });
  }
};

function getMarketStatus() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day === 0 || day === 6) return "CLOSED";
  if (hour >= 9 && hour < 15) return "OPEN";
  return "CLOSED";
}

// =====================
// EXIT SINGLE LEG
// CRITICAL FIXES:
// 1. Mark entire position as closed when both legs closed (prevents reload on restart)
// 2. Match both symbol formats (full ISO and strike-only)
// 3. Save immediately to DB
// =====================
exports.exitSingle = async (req, res) => {
  try {
    const { symbol, qty } = req.body;
    const mode = req.query.mode || "live";

    if (mode === "paper") {
      const positions = tradingService.getPositions();

      for (const p of positions) {
        // skip already fully closed positions
        if (p.isClosed) continue;

        // ── IRON FLY: close only matched leg, mark position closed when all legs closed ──
        if (p.strategyType === "IRON_FLY") {
          const allLegs = [
            p.if_ceSell,
            p.if_peSell,
            p.if_ceBuy,
            p.if_peBuy,
            ...(p.if_bwLegs || []),
          ];
          const matched = allLegs.find(
            (l) => l && !l.closed && l.symbol === symbol,
          );
          if (matched) {
            // close only this specific leg
            matched.closed = true;
            matched.exitPrice = matched.currentPrice || matched.entryPremium;
            matched.closedAt = new Date().toISOString();

            // check if ALL legs are now closed
            const allClosed = [
              p.if_ceSell,
              p.if_peSell,
              p.if_ceBuy,
              p.if_peBuy,
              ...(p.if_bwLegs || []),
            ].every((l) => !l || l.closed);

            if (allClosed) {
              p.isClosed = true;
              p.isActive = false;
            }

            if (p._id) {
              await PositionModel.findByIdAndUpdate(p._id, {
                isClosed: p.isClosed,
                isActive: p.isActive,
                if_ceSell: p.if_ceSell,
                if_peSell: p.if_peSell,
                if_ceBuy: p.if_ceBuy,
                if_peBuy: p.if_peBuy,
                if_bwLegs: p.if_bwLegs,
              });
            }
          }
          continue;
        }
        // ── STRADDLE / STRANGLE: match st_legs array ──
        if (
          p.strategyType === "INTRADAY_STRADDLE" ||
          p.strategyType === "INTRADAY_STRANGLE"
        ) {
          const leg = (p.st_legs || []).find(
            (l) => !l.closed && l.symbol === symbol,
          );
          if (leg) {
            leg.closed = true;
            leg.exitPrice = leg.currentPrice || leg.entryPremium;
            leg.closedAt = new Date().toISOString();
            const allClosed = p.st_legs.every((l) => l.closed);
            if (allClosed) {
              p.isClosed = true;
              p.isActive = false;
            }
            if (p._id) {
              await PositionModel.findByIdAndUpdate(p._id, {
                st_legs: p.st_legs,
                isClosed: p.isClosed,
                isActive: p.isActive,
              });
            }
          }
          continue; // skip debit spread matching for straddle
        }

        let legClosed = false;

        // match buy leg - check both full symbol and strike-only format
        const buySymbolMatch =
          p.buySymbol === symbol || `${p.index} ${p.buyStrike}` === symbol;
        const sellSymbolMatch =
          p.sellSymbol === symbol || `${p.index} ${p.sellStrike}` === symbol;

        if (buySymbolMatch) {
          logger.log(`🚪 Closing BUY leg: ${symbol} (position ${p._id})`);
          p.buyQty = 0;
          p.buyClosed = true;
          legClosed = true;
        }

        if (sellSymbolMatch) {
          logger.log(`🚪 Closing SELL leg: ${symbol} (position ${p._id})`);
          p.sellQty = 0;
          legClosed = true;
        }

        // ── CRITICAL: if both legs closed, mark ENTIRE position as closed ──
        // This prevents the position from being reloaded on server restart
        if (p.buyQty === 0 && p.sellQty === 0) {
          p.isClosed = true;
          p.isActive = false;
          logger.log(
            `✅ Both legs closed → marking position ${p._id} as CLOSED`,
          );
        }

        // ── save to DB immediately ──
        if (legClosed && p._id) {
          const updateData = {
            buyQty: p.buyQty,
            sellQty: p.sellQty,
            buyClosed: p.buyClosed,
            isClosed: p.isClosed,
            isActive: p.isActive,
          };

          await PositionModel.findByIdAndUpdate(p._id, updateData);
          logger.log(
            `💾 Saved to DB: buyQty=${p.buyQty}, sellQty=${p.sellQty}, isClosed=${p.isClosed}`,
          );
        }
      }

      // ── CRITICAL FIX: purge fully-closed positions from in-memory array ──
      // Without this, getPaperPositions returns stale closed legs alongside new spread
      // positionManager.positions is the live array — filter it directly
      const mgr = require("../../managers/positionManagerInstance");
      mgr.positions = mgr.positions.filter((p) => !p.isClosed);
      logger.log(
        `🧹 Memory cleanup: ${mgr.positions.length} active position(s) remain`,
      );

      return res.json({ success: true });
    }

    // LIVE MODE
    const user = await User.findById(req.user);
    await zerodhaService.placeOrder(user.broker.accessToken, {
      tradingsymbol: symbol,
      exchange: "NFO",
      transaction_type: "BUY",
      order_type: "LIMIT",
      quantity: qty,
      price: 1,
      product: "NRML",
    });

    res.json({ success: true });
  } catch (err) {
    logger.error("Exit single error:", err.message);
    res.status(500).json({ msg: "Exit failed" });
  }
};

// =====================
// PAPER POSITIONS
// LTP injected from live tick map (bridge)
// PNL recalculated fresh every call
// Closed legs show as "BUY  SELL" or "SELL  BUY" for clarity
// Strangle legs guarded: only push if strike exists and is a number
// =====================
exports.getPaperPositions = async (req, res) => {
  try {
    const lastTickMap = getTickMap();
    let positions = tradingService.getPositions();

    // ── filter by strategyType if provided ──
    const filterType = req.query.strategyType;
    if (filterType) {
      if (filterType === "DEBIT_SPREAD") {
        positions = positions.filter(
          (p) =>
            p.strategyType !== "INTRADAY_STRADDLE" &&
            p.strategyType !== "INTRADAY_STRANGLE" &&
            p.strategyType !== "IRON_FLY",
        );
      } else {
        positions = positions.filter((p) => p.strategyType === filterType);
      }
    }

    const formatted = [];
    let legOrder = 0;
    positions.forEach((p) => {
      // ── IRON FLY — 4 legs + optional broken wing legs ──
      if (p.strategyType === "IRON_FLY") {
        const ifLegs = [
          {
            leg: p.if_ceSell,
            type: "SELL",
            optType: "CE",
            label: "ATM CE SELL",
          },
          {
            leg: p.if_peSell,
            type: "SELL",
            optType: "PE",
            label: "ATM PE SELL",
          },
          { leg: p.if_ceBuy, type: "BUY", optType: "CE", label: "CE WING BUY" },
          { leg: p.if_peBuy, type: "BUY", optType: "PE", label: "PE WING BUY" },
        ];
        for (const { leg, type, optType } of ifLegs) {
          if (!leg) continue;
          const ltp =
            lastTickMap[Number(leg.token)] ||
            leg.currentPrice ||
            leg.entryPremium ||
            0;
          const entryPrem = leg.entryPremium || 0;
          const exitPrice = leg.exitPrice || ltp;
          const isClosed = leg.closed || false;
          const pnl =
            type === "SELL"
              ? (entryPrem - (isClosed ? exitPrice : ltp)) * (p.quantity || 0)
              : ((isClosed ? exitPrice : ltp) - entryPrem) * (p.quantity || 0);
          formatted.push({
            token: Number(leg.token),
            symbol: leg.symbol || `${p.index} ${leg.strike} ${optType}`,
            legOrder: ++legOrder,
            qty: type === "SELL" ? -(p.quantity || 0) : p.quantity || 0,
            expiry: p.expiry,
            type,
            lots: p.lots || 1,
            strategyType: p.strategyType,
            avgPrice: Number(entryPrem.toFixed(2)),
            ltp: Number((isClosed ? exitPrice : ltp).toFixed(2)),
            pnl: Number(pnl.toFixed(2)),
            status: isClosed ? "CLOSED" : "OPEN",
            points: calcPoints(
              entryPrem,
              isClosed ? exitPrice : ltp,
              type === "BUY",
            ),
            openedAt: leg.openedAt || null,
            closedAt: leg.closedAt || null,
          });
        }
        // ── broken wing legs ──
        for (const leg of p.if_bwLegs || []) {
          const ltp =
            lastTickMap[Number(leg.token)] ||
            leg.currentPrice ||
            leg.entryPremium ||
            0;
          const entryPrem = leg.entryPremium || 0;
          const exitPrice = leg.exitPrice || ltp;
          const isClosed = leg.closed || false;
          const type = leg.isBuy ? "BUY" : "SELL";
          const pnl = leg.isBuy
            ? ((isClosed ? exitPrice : ltp) - entryPrem) * (p.quantity || 0)
            : (entryPrem - (isClosed ? exitPrice : ltp)) * (p.quantity || 0);
          formatted.push({
            token: Number(leg.token),
            symbol: leg.symbol || `${p.index} ${leg.strike} ${leg.type}`,
            legOrder: ++legOrder,
            qty: leg.isBuy ? p.quantity || 0 : -(p.quantity || 0),
            expiry: p.expiry,
            type,
            lots: p.lots || 1,
            strategyType: p.strategyType,
            avgPrice: Number(entryPrem.toFixed(2)),
            ltp: Number((isClosed ? exitPrice : ltp).toFixed(2)),
            pnl: Number(pnl.toFixed(2)),
            status: isClosed ? "CLOSED" : "OPEN",
            points: calcPoints(
              entryPrem,
              isClosed ? exitPrice : ltp,
              leg.isBuy,
            ),
            openedAt: leg.openedAt || null,
            closedAt: leg.closedAt || null,
          });
        }
        return;
      }
      // ── INTRADAY STRADDLE / STRANGLE
      if (
        p.strategyType === "INTRADAY_STRADDLE" ||
        p.strategyType === "INTRADAY_STRANGLE"
      ) {
        for (const leg of p.st_legs || []) {
          const ltp =
            lastTickMap[Number(leg.token)] ||
            leg.currentPrice ||
            leg.entryPremium ||
            0;
          const pnl = leg.closed
            ? ((leg.entryPremium || 0) -
                (leg.exitPrice || leg.entryPremium || 0)) *
              (p.quantity || 0)
            : ((leg.entryPremium || 0) - ltp) * (p.quantity || 0);
          formatted.push({
            token: Number(leg.token),
            symbol: leg.symbol || `${p.index} ${leg.strike} ${leg.type}`,
            legOrder: ++legOrder,
            qty: -(p.quantity || 0),
            expiry: p.expiry,
            type: leg.closed ? "SELL → BUY" : "SELL",
            lots: p.lots || 1,
            strategyType: p.strategyType,
            avgPrice: Number((leg.entryPremium || 0).toFixed(2)),
            ltp: Number(
              (leg.closed
                ? leg.exitPrice || leg.entryPremium || 0
                : ltp
              ).toFixed(2),
            ),
            pnl: Number(pnl.toFixed(2)),
            status: leg.closed ? "CLOSED" : "OPEN",
            points: calcPoints(
              leg.entryPremium || 0,
              leg.closed ? leg.exitPrice || leg.entryPremium || 0 : ltp,
              false,
            ),
            openedAt: leg.openedAt || null,
            closedAt: leg.closedAt || null,
          });
        }
        return; // skip debit spread rendering — straddle done
      }

      // ── CLOSED BUY LEGS (from profit shifts) ──
      // ── BUILD ALL LEGS WITH TIMESTAMPS THEN SORT CHRONOLOGICALLY ──
      const allLegs = [];

      // closed buy legs from profit shifts
      (p.closedBuyLegs || []).forEach((leg) => {
        const pnl = (leg.exitPremium - leg.entryPremium) * (p.quantity || 0);
        allLegs.push({
          token: leg.token,
          symbol: leg.symbol,
          expiry: p.expiry,
          qty: 0,
          lots: p.lots || 1,
          avgPrice: Number((leg.entryPremium || 0).toFixed(2)),
          ltp: Number((leg.exitPremium || 0).toFixed(2)),
          pnl: Number(pnl.toFixed(2)),
          type: "BUY → SELL",
          status: "CLOSED",
          points: calcPoints(leg.entryPremium, leg.exitPremium, true),
          openedAt: leg.openedAt || null,
          closedAt: leg.closedAt || null,
          _ts: leg.closedAt ? new Date(leg.closedAt).getTime() : 1,
        });
      });

      // buy leg
      const buyLtp =
        p.buyQty === 0
          ? p.closedBuyPrice || p.currentBuyPrice || p.buyAvgPrice || 0
          : lastTickMap[p.buyToken] || p.currentBuyPrice || p.buyAvgPrice || 0;
      const buyPnl =
        p.buyQty === 0
          ? ((p.closedBuyPrice || p.currentBuyPrice || p.buyAvgPrice || 0) -
              (p.buyAvgPrice || 0)) *
            (p.quantity || 0)
          : (buyLtp - (p.buyAvgPrice || 0)) * (p.buyQty || 0);
      allLegs.push({
        token: p.buyToken,
        symbol: p.buySymbol || `${p.index} ${p.buyStrike}`,
        expiry: p.expiry,
        margin: p.margin || 0,
        qty: p.buyQty === 0 ? p.quantity : p.buyQty,
        lots: p.lots || 1,
        avgPrice: Number((p.buyAvgPrice || 0).toFixed(2)),
        ltp: Number(buyLtp.toFixed(2)),
        pnl: Number(buyPnl.toFixed(2)),
        type: p.buyQty !== 0 ? "BUY" : "BUY → SELL",
        status: p.buyQty !== 0 ? "OPEN" : "CLOSED",
        points: calcPoints(p.buyAvgPrice, buyLtp, true),
        openedAt: p.entryTime ? new Date(p.entryTime).toISOString() : null,
        closedAt: p.buyQty === 0 && p.closedBuyAt ? p.closedBuyAt : null,
        _ts: p.entryTime || 2,
      });

      // sell leg
      const sellLtp =
        p.sellQty === 0
          ? p.closedSellPrice || p.currentSellPrice || p.sellAvgPrice || 0
          : lastTickMap[p.sellToken] ||
            p.currentSellPrice ||
            p.sellAvgPrice ||
            0;
      const sellPnl =
        p.sellQty === 0
          ? ((p.sellAvgPrice || 0) -
              (p.closedSellPrice ||
                p.currentSellPrice ||
                p.sellAvgPrice ||
                0)) *
            (p.quantity || 0)
          : ((p.sellAvgPrice || 0) - sellLtp) * (p.sellQty || 0);
      allLegs.push({
        token: p.sellToken,
        symbol: p.sellSymbol || `${p.index} ${p.sellStrike}`,
        expiry: p.expiry,
        margin: p.margin || 0,
        qty: -(p.sellQty || 0),
        lots: p.lots || 1,
        avgPrice: Number((p.sellAvgPrice || 0).toFixed(2)),
        ltp: Number(sellLtp.toFixed(2)),
        pnl: Number(sellPnl.toFixed(2)),
        type: p.sellQty !== 0 ? "SELL" : "SELL → BUY",
        status: p.sellQty !== 0 ? "OPEN" : "CLOSED",
        points: calcPoints(p.sellAvgPrice, sellLtp, false),
        openedAt: p.entryTime ? new Date(p.entryTime).toISOString() : null,
        closedAt: null,
        _ts: (p.entryTime || 3) + 1,
      });

      // active CE strangle leg
      if (
        p.isStrangle &&
        p.CE_sell &&
        typeof p.CE_sell.strike === "number" &&
        !isNaN(p.CE_sell.strike) &&
        p.CE_sell.strike !== p.sellStrike
      ) {
        const ceLtp =
          p.CE_sell.currentPrice ||
          lastTickMap[p.CE_sell.token] ||
          p.CE_sell.premium ||
          0;
        const cePnl = ((p.CE_sell.premium || 0) - ceLtp) * (p.quantity || 0);
        allLegs.push({
          token: p.CE_sell.token,
          symbol: buildSymbol({
            instrument: p.index,
            strike: p.CE_sell.strike,
            type: "CE",
            expiry: p.expiry,
          }),
          expiry: p.expiry,
          qty: -(p.quantity || 0),
          lots: p.lots || 1,
          avgPrice: Number((p.CE_sell.premium || 0).toFixed(2)),
          ltp: Number(ceLtp.toFixed(2)),
          pnl: Number(cePnl.toFixed(2)),
          type: "SELL",
          status: "OPEN",
          points: calcPoints(p.CE_sell.premium || 0, ceLtp, false),
          openedAt: p.CE_sell.openedAt || null,
          closedAt: null,
          _ts: p.CE_sell.openedAt
            ? new Date(p.CE_sell.openedAt).getTime()
            : Date.now(),
        });
      }

      // active PE strangle leg (BULL_CALL only)
      if (
        p.isStrangle &&
        p.type === "BULL_CALL" &&
        p.PE_sell &&
        typeof p.PE_sell.strike === "number" &&
        !isNaN(p.PE_sell.strike)
      ) {
        const peLtp =
          p.PE_sell.currentPrice ||
          lastTickMap[p.PE_sell.token] ||
          p.PE_sell.premium ||
          0;
        const pePnl = ((p.PE_sell.premium || 0) - peLtp) * (p.quantity || 0);
        allLegs.push({
          token: p.PE_sell.token,
          symbol: buildSymbol({
            instrument: p.index,
            strike: p.PE_sell.strike,
            type: "PE",
            expiry: p.expiry,
          }),
          expiry: p.expiry,
          qty: -(p.quantity || 0),
          lots: p.lots || 1,
          avgPrice: Number((p.PE_sell.premium || 0).toFixed(2)),
          ltp: Number(peLtp.toFixed(2)),
          pnl: Number(pePnl.toFixed(2)),
          type: "SELL",
          status: "OPEN",
          points: calcPoints(p.PE_sell.premium || 0, peLtp, false),
          openedAt: p.PE_sell.openedAt || null,
          closedAt: null,
          _ts: p.PE_sell.openedAt
            ? new Date(p.PE_sell.openedAt).getTime()
            : Date.now(),
        });
      }

      // closed strangle legs
      (p.closedStrangleLegs || []).forEach((leg) => {
        allLegs.push({
          token: null,
          symbol: buildSymbol({
            instrument: p.index,
            strike: leg.strike,
            type: leg.type,
            expiry: p.expiry,
          }),
          expiry: p.expiry,
          qty: -(p.quantity || 0),
          lots: p.lots || 1,
          avgPrice: Number((leg.entryPremium || 0).toFixed(2)),
          ltp: Number((leg.exitPremium || 0).toFixed(2)),
          pnl: Number((leg.pnl || 0).toFixed(2)),
          type: "SELL → BUY",
          status: "CLOSED",
          points: calcPoints(
            leg.entryPremium || 0,
            leg.exitPremium || 0,
            false,
          ),
          openedAt: leg.openedAt || null,
          closedAt: leg.closedAt || null,
          _ts: leg.openedAt
            ? new Date(leg.openedAt).getTime()
            : leg.closedAt
              ? new Date(leg.closedAt).getTime()
              : Date.now(),
        });
      });

      // ── sort all legs by timestamp then assign legOrder ──
      allLegs.sort((a, b) => a._ts - b._ts);
      allLegs.forEach((leg) => {
        formatted.push({ ...leg, legOrder: ++legOrder });
      });
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    logger.error("getPaperPositions error:", err.message);
    res.json({ success: true, data: [] });
  }
};

// =====================
// GET REAL EXPIRIES FROM ZERODHA INSTRUMENTS
// Returns actual expiry dates for NIFTY or BANKNIFTY
// filtered to only future expiries (today included if market open)
// =====================
exports.getExpiries = async (req, res) => {
  try {
    const { instrument } = req.query;
    if (!instrument)
      return res
        .status(400)
        .json({ success: false, message: "instrument required" });

    const user = await User.findById(req.user);
    if (!user?.broker?.accessToken) {
      return res
        .status(400)
        .json({ success: false, message: "Broker not connected" });
    }

    const instruments = await zerodhaService.getInstruments();

    const now = new Date();
    // include today if market not yet closed (before 3:30 PM IST)
    const marketStillOpen =
      now.getHours() < 15 || (now.getHours() === 15 && now.getMinutes() <= 30);
    const todayStr = now.toISOString().split("T")[0];

    // get unique expiry dates for this instrument from NFO options
    const expiries = [
      ...new Set(
        instruments
          .filter((i) => i.name === instrument && i.segment === "NFO-OPT")
          .map((i) => new Date(i.expiry).toISOString().split("T")[0]),
      ),
    ]
      .sort()
      .filter((e) => {
        if (e > todayStr) return true; // future expiry always included
        if (e === todayStr) return marketStillOpen; // today only if market open
        return false; // past expiry excluded
      })
      .slice(0, instrument === "BANKNIFTY" ? 2 : 4); // NIFTY: 4 weekly, BANKNIFTY: 2 monthly

    // format for frontend: { label: "14 MAY", date: "2026-05-14", daysToExpiry: N }
    const formatted = expiries.map((e) => {
      const d = new Date(e);
      const label = d
        .toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
        .toUpperCase();
      const isToday = e === todayStr;
      const daysToExpiry = isToday
        ? 0
        : Math.ceil((d - now) / (1000 * 60 * 60 * 24));
      return { label, date: e, daysToExpiry };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    logger.error("getExpiries error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch expiries" });
  }
};
