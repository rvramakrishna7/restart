const logger = require("../utils/logger");
const routeAdjustment = require("../engine/strategyRouter");
const getOptionChain = require("../engine/optionChain");
const Trade = require("../api/models/Trade");
const {
  initWebSocket,
  updateSubscription,
} = require("../services/websocketService");
const zerodhaService = require("../services/zerodhaService");
const PositionModel = require("../api/models/Position");
const { sendAlert } = require("../services/notify");
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n >= 0 ? "+" : "") + money(n);

function isMarketOpen() {
  // Compute current time in IST regardless of server timezone (Render = UTC)
  const nowUTC = new Date();
  const istMs = nowUTC.getTime() + (5 * 60 + 30) * 60 * 1000; // +5:30
  const ist = new Date(istMs);
  const day = ist.getUTCDay();      // use UTC getters on the shifted time
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  if (day === 0 || day === 6) return false;             // Sun/Sat
  if (hour < 9 || (hour === 9 && minute < 15)) return false;  // before 09:15
  if (hour > 15 || (hour === 15 && minute > 30)) return false; // after 15:30
  return true;
}

class PositionManager {
  constructor() {
    this.positions = [];
    this.latestChain = [];
    this.isMonitoring = false;
    this.lastChainFetch = 0;
  }

  async addPosition(position) {
    position.isActive = true;
    position.entryTime = Date.now();
    this.positions.push(position);

    logger.log("\nPosition Opened");
    logger.log("Index:", position.index);
    if (position.strategyType === "INTRADAY_STRADDLE") {
      logger.log("ATM Strike:", position.st_legs?.[0]?.strike);
    } else if (position.strategyType === "INTRADAY_STRANGLE") {
      const ce = position.st_legs?.find((l) => l.type === "CE");
      const pe = position.st_legs?.find((l) => l.type === "PE");
      logger.log("CE Strike:", ce?.strike, "| PE Strike:", pe?.strike);
    } else if (position.strategyType === "IRON_FLY") {
      logger.log("ATM Strike:", position.if_atmStrike);
      logger.log(
        "CE Buy:",
        position.if_ceBuy?.strike,
        "| PE Buy:",
        position.if_peBuy?.strike,
      );
      logger.log(
        "Net Premium:",
        position.if_netPremium,
        "| Upper BE:",
        position.if_upperBreakeven,
        "| Lower BE:",
        position.if_lowerBreakeven,
      );
    } else {
      logger.log("Buy Strike:", position.buyStrike);
      logger.log("Sell Strike:", position.sellStrike);
    }
    logger.log("Lot Size:", position.lotSize);
    logger.log("Lots:", position.lots);
    logger.log("Actual Qty:", position.quantity);

    if (position.orderIds) {
      this.startOrderTracking(position);
    }

    position.buyQty = position.quantity;
    position.sellQty = position.quantity;

    try {
      const saved = await PositionModel.create(position);
      position._id = saved._id;
      logger.log("💾 Position saved to DB");
      // ── re-subscribe after 3 seconds to catch any missed initial ticks ──
      // setTimeout(() => {
      //   this.updateTokens();
      // }, 3000);
      this.subscribeOtmTokens(position);
      this.updateTokens();
      // ── force resubscribe after 3 seconds to ensure new tokens are live ──
      setTimeout(() => {
        this.updateTokens();
      }, 3000);
    } catch (err) {
      logger.log("❌ DB Save Error:", err.message);
    }
  }

  startOrderTracking(position) {
    if (position.mode === "paper") return;
    if (!position.orderIds) return;

    logger.log("📡 Starting Order Status Tracking...");
    const token = position.token;

    const interval = setInterval(async () => {
      try {
        if (position.orderStatus.buy !== "COMPLETE") {
          const buyDetails = await zerodhaService.getOrderDetails(
            token,
            position.orderIds.buy,
          );
          if (buyDetails?.status) {
            position.orderStatus.buy = buyDetails.status;
            logger.log("BUY STATUS:", buyDetails.status);
          }
        }
        if (position.orderStatus.sell !== "COMPLETE") {
          const sellDetails = await zerodhaService.getOrderDetails(
            token,
            position.orderIds.sell,
          );
          if (sellDetails?.status) {
            position.orderStatus.sell = sellDetails.status;
            logger.log("SELL STATUS:", sellDetails.status);
          }
        }
        if (
          position.orderStatus.buy === "COMPLETE" &&
          position.orderStatus.sell === "COMPLETE"
        ) {
          logger.log("✅ Both legs COMPLETE → stopping tracker");
          clearInterval(interval);
        }
      } catch (err) {
        logger.log("⚠️ Order tracking error:", err.message);
      }
    }, 1000);
  }

  async loadPositionsFromDB() {
    try {
      const positions = await PositionModel.find({ isClosed: false });
      this.positions = positions;

      for (let pos of this.positions) {
        pos.quantity = Number(pos.quantity || 0);
        pos.mode = pos.mode || "paper";
        pos.buyQty = typeof pos.buyQty === "number" ? pos.buyQty : pos.quantity;
        pos.sellQty =
          typeof pos.sellQty === "number" ? pos.sellQty : pos.quantity;
        pos.isActive =
          typeof pos.isActive === "undefined" ? true : pos.isActive;
        pos.lots = Number(pos.lots || 1);
        pos.buyAvgPrice = Number(pos.buyAvgPrice || pos.buyPremium || 0);
        pos.sellAvgPrice = Number(pos.sellAvgPrice || pos.sellPremium || 0);
        pos.realizedProfitFromShifts = Number(
          pos.realizedProfitFromShifts || 0,
        );
        pos.closedBuyLegs = Array.isArray(pos.closedBuyLegs)
          ? pos.closedBuyLegs
          : [];
        pos.basePremium = Number(pos.basePremium || 0);
        pos.CE_sell = pos.CE_sell || null;
        pos.PE_sell = pos.PE_sell || null;
        pos.closedStrangleLegs = Array.isArray(pos.closedStrangleLegs)
          ? pos.closedStrangleLegs
          : [];
        pos.lossAdjusted = pos.lossAdjusted || false;
        pos.isStrangle = pos.isStrangle || false;
        pos.buySymbol = pos.buySymbol || null;
        pos.sellSymbol = pos.sellSymbol || null;
        pos.currentLegEntryPrice = Number(pos.currentLegEntryPrice || 0);
        pos.pnl = Number(pos.pnl || 0);
        pos.history = Array.isArray(pos.history) ? [...pos.history] : [];
        pos.entryTime = pos.createdAt
          ? new Date(pos.createdAt).getTime()
          : Date.now() - 120 * 1000;

        // ── Straddle / Strangle: restore leg array ──
        if (
          pos.strategyType === "INTRADAY_STRADDLE" ||
          pos.strategyType === "INTRADAY_STRANGLE"
        ) {
          pos.st_legs = Array.isArray(pos.st_legs) ? pos.st_legs : [];
          pos.st_realizedPnl = Number(pos.st_realizedPnl || 0);
        }
        // ── Iron fly: restore all if_ fields ──
        if (pos.strategyType === "IRON_FLY") {
          pos.if_realizedLoss = Number(pos.if_realizedLoss || 0);
          pos.if_rule1CeFired = pos.if_rule1CeFired || false;
          pos.if_rule1PeFired = pos.if_rule1PeFired || false;
          pos.if_bwActive = pos.if_bwActive || false;
          pos.if_bwLegs = Array.isArray(pos.if_bwLegs) ? pos.if_bwLegs : [];
          pos.st_currentFuturePrice = pos.st_currentFuturePrice || 0;
        }

        logger.log(
          "♻️ RESTORED |",
          pos.index,
          pos.type,
          "| buy:",
          pos.buyStrike,
          "@",
          pos.buyAvgPrice,
          "| sell:",
          pos.sellStrike,
          "@",
          pos.sellAvgPrice,
          "| isStrangle:",
          pos.isStrangle,
          "| lossAdjusted:",
          pos.lossAdjusted,
          "| shiftCount:",
          pos.shiftCount,
          "| basePremium:",
          pos.basePremium,
          "| closedBuyLegs:",
          pos.closedBuyLegs?.length || 0,
          "| closedStrangleLegs:",
          pos.closedStrangleLegs?.length || 0,
        );
      }

      logger.log(`♻️ Loaded ${positions.length} open positions from DB`);

      for (const pos of this.positions) {
        if (pos.mode !== "paper" && pos.orderIds) this.startOrderTracking(pos);
        if (
          pos.strategyType === "INTRADAY_STRADDLE" ||
          pos.strategyType === "INTRADAY_STRANGLE"
        ) {
          const openLegs = (pos.st_legs || [])
            .filter((l) => !l.closed)
            .map((l) => l.strike)
            .join("/");
          logger.log(
            `🔄 Restarting straddle monitor for ${pos.index} | legs: ${openLegs}`,
          );
        } else if (pos.strategyType === "IRON_FLY") {
          logger.log(
            `🔄 Restarting iron fly monitor for ${pos.index} | ATM: ${pos.if_atmStrike} | BE: ${pos.if_lowerBreakeven}-${pos.if_upperBreakeven}`,
          );
        } else {
          logger.log(
            `🔄 Restarting monitor for ${pos.index} ${pos.buyStrike}/${pos.sellStrike}`,
          );
        }
      }

      if (!positions.length) return;

      const allTokens = [];
      for (let pos of positions) {
        if (pos.buyToken) allTokens.push(Number(pos.buyToken));
        if (pos.sellToken) allTokens.push(Number(pos.sellToken));
        if (pos.otmToken100) allTokens.push(Number(pos.otmToken100));
        if (pos.otmToken50) allTokens.push(Number(pos.otmToken50));
        if (pos.isStrangle) {
          if (pos.CE_sell?.token) allTokens.push(Number(pos.CE_sell.token));
          if (pos.PE_sell?.token) allTokens.push(Number(pos.PE_sell.token));
        }
        // ── Straddle / Strangle tokens ──
        if (
          pos.strategyType === "INTRADAY_STRADDLE" ||
          pos.strategyType === "INTRADAY_STRANGLE"
        ) {
          if (pos.st_futureToken) allTokens.push(Number(pos.st_futureToken));
          for (const leg of pos.st_legs || []) {
            if (!leg.closed && leg.token) allTokens.push(Number(leg.token));
          }
        }
        // ── Iron fly tokens ──
        if (pos.strategyType === "IRON_FLY") {
          if (pos.st_futureToken) allTokens.push(Number(pos.st_futureToken));
          if (pos.if_ceSell?.token) allTokens.push(Number(pos.if_ceSell.token));
          if (pos.if_peSell?.token) allTokens.push(Number(pos.if_peSell.token));
          if (pos.if_ceBuy?.token && !pos.if_ceBuy.closed)
            allTokens.push(Number(pos.if_ceBuy.token));
          if (pos.if_peBuy?.token && !pos.if_peBuy.closed)
            allTokens.push(Number(pos.if_peBuy.token));
          for (const leg of pos.if_bwLegs || []) {
            if (!leg.closed && leg.token) allTokens.push(Number(leg.token));
          }
        }
      }

      const uniqueTokens = [...new Set(allTokens)];
      this.startWebSocket({
        token: positions[0].token,
        buyToken: uniqueTokens[0],
        sellToken: uniqueTokens[1],
      });
      // ── subscribe ALL tokens including OTM after WS starts ──
      setTimeout(() => {
        logger.log("📡 Restoring all tokens after restart:", uniqueTokens);
        updateSubscription([...uniqueTokens, 256265, 260105]);
      }, 2000);
    } catch (err) {
      logger.log("❌ Load Positions Error:", err.message);
    }
  }

  // =====================
  // WEBSOCKET ENGINE
  // =====================
  startWebSocket(position) {
    this.isMonitoring = true;

    const allTokens = [];
    for (let pos of this.positions) {
      if (pos.buyToken) allTokens.push(pos.buyToken);
      if (pos.sellToken) allTokens.push(pos.sellToken);
    }
    const tokens = [...new Set([...allTokens, 256265, 260105])];

    logger.log("📡 Starting WebSocket...");
    if (global.wsStarted) {
      logger.log(
        "📡 WS already running → updating subscription for restored positions",
      );
      updateSubscription(tokens);
      return;
    }

    // ── do not start WS if broker was manually disconnected ──
    if (global.brokerDisconnected) {
      logger.log("🔌 Broker disconnected — skipping WS start");
      return;
    }

    const started = initWebSocket(
      position.token,
      tokens,
      this.handleTicks.bind(this),
    );
    if (started !== false) global.wsStarted = true;
  }

  getPositions() {
    return this.positions;
  }

  subscribeOtmTokens(position) {
    try {
      const otmTokens = [position.otmToken100, position.otmToken50]
        .filter((t) => t && Number(t) > 0)
        .map(Number);
      if (!otmTokens.length) return;
      logger.log("📡 Subscribing OTM tokens:", otmTokens);
      updateSubscription(
        [...otmTokens, position.buyToken, position.sellToken].filter(Boolean),
      );
    } catch (err) {
      logger.log("⚠️ subscribeOtmTokens error:", err.message);
    }
  }

  // =====================
  // TICK HANDLER
  // =====================
  handleTicks = async (ticks) => {
    for (let tick of ticks) {
      const token = tick.instrument_token;
      const price = tick.last_price;

      for (let pos of this.positions) {
        // ── TYPE DEBUG — remove after fix confirmed ──
        // ── TYPE DEBUG — debit spread only ──
        if (!pos._tokenTypeLogged && pos.buyToken) {
          pos._tokenTypeLogged = true;
          logger.log(
            "🔍 TOKEN TYPE CHECK | tick token:",
            token,
            typeof token,
            "| pos.buyToken:",
            pos.buyToken,
            typeof pos.buyToken,
          );
        }
        // ── Debit spread leg prices ──
        if (token === pos.buyToken) pos.currentBuyPrice = price;
        if (token === pos.sellToken) pos.currentSellPrice = price;
        // ── Debit spread strangle leg prices ──
        if (pos.isStrangle) {
          if (pos.CE_sell?.token && token === Number(pos.CE_sell.token))
            pos.CE_sell.currentPrice = price;
          if (pos.PE_sell?.token && token === Number(pos.PE_sell.token))
            pos.PE_sell.currentPrice = price;
        }

        // ── Straddle / Strangle: futures price + individual leg prices ──
        if (
          pos.strategyType === "INTRADAY_STRADDLE" ||
          pos.strategyType === "INTRADAY_STRANGLE"
        ) {
          if (pos.st_futureToken && token === Number(pos.st_futureToken)) {
            pos.st_currentFuturePrice = price;
          }
          if (Array.isArray(pos.st_legs)) {
            for (const leg of pos.st_legs) {
              if (!leg.closed && leg.token && token === Number(leg.token)) {
                leg.currentPrice = price;
              }
            }
          }
        }
        // ── Iron fly: futures price + all leg prices ──
        if (pos.strategyType === "IRON_FLY") {
          if (pos.st_futureToken && token === Number(pos.st_futureToken)) {
            pos.st_currentFuturePrice = price;
          }
          if (pos.if_ceSell?.token && token === Number(pos.if_ceSell.token))
            pos.if_ceSell.currentPrice = price;
          if (pos.if_peSell?.token && token === Number(pos.if_peSell.token))
            pos.if_peSell.currentPrice = price;
          if (
            pos.if_ceBuy?.token &&
            !pos.if_ceBuy.closed &&
            token === Number(pos.if_ceBuy.token)
          )
            pos.if_ceBuy.currentPrice = price;
          if (
            pos.if_peBuy?.token &&
            !pos.if_peBuy.closed &&
            token === Number(pos.if_peBuy.token)
          )
            pos.if_peBuy.currentPrice = price;
          for (const leg of pos.if_bwLegs || []) {
            if (!leg.closed && leg.token && token === Number(leg.token))
              leg.currentPrice = price;
          }
        }
      }
    }

    // ── PnL for debit spread positions ──
    for (let pos of this.positions) {
      if (
        pos.strategyType === "INTRADAY_STRADDLE" ||
        pos.strategyType === "INTRADAY_STRANGLE" ||
        pos.strategyType === "IRON_FLY"
      ) {
        // PnL computed inside strategy engine
        continue;
      }

      const buyPnl =
        ((pos.currentBuyPrice || pos.buyAvgPrice) - pos.buyAvgPrice) *
        pos.quantity;
      const sellPnl =
        (pos.sellAvgPrice - (pos.currentSellPrice || pos.sellAvgPrice)) *
        pos.quantity;

      pos.pnl = Number((buyPnl + sellPnl).toFixed(2));
      pos.ltp = Number(
        ((pos.currentBuyPrice || 0) + (pos.currentSellPrice || 0)).toFixed(2),
      );
      pos.status = pos.isClosed ? "CLOSED" : "OPEN";
    }

    await this.updatePremium();
  };

  // =====================
  // TOKEN SUBSCRIPTION UPDATE
  // =====================
  updateTokens() {
    const allTokens = [];
    for (let position of this.positions) {
      if (position.buyToken) allTokens.push(Number(position.buyToken));
      if (position.sellToken) allTokens.push(Number(position.sellToken));
      if (position.otmToken100) allTokens.push(Number(position.otmToken100));
      if (position.otmToken50) allTokens.push(Number(position.otmToken50));
      if (position.isStrangle) {
        if (position.CE_sell?.token)
          allTokens.push(Number(position.CE_sell.token));
        if (position.PE_sell?.token)
          allTokens.push(Number(position.PE_sell.token));
      }
      if (
        position.strategyType === "INTRADAY_STRADDLE" ||
        position.strategyType === "INTRADAY_STRANGLE"
      ) {
        if (position.st_futureToken)
          allTokens.push(Number(position.st_futureToken));
        for (const leg of position.st_legs || []) {
          if (!leg.closed && leg.token) allTokens.push(Number(leg.token));
        }
      }
      if (position.strategyType === "IRON_FLY") {
        if (position.st_futureToken)
          allTokens.push(Number(position.st_futureToken));
        if (position.if_ceSell?.token)
          allTokens.push(Number(position.if_ceSell.token));
        if (position.if_peSell?.token)
          allTokens.push(Number(position.if_peSell.token));
        if (position.if_ceBuy?.token && !position.if_ceBuy.closed)
          allTokens.push(Number(position.if_ceBuy.token));
        if (position.if_peBuy?.token && !position.if_peBuy.closed)
          allTokens.push(Number(position.if_peBuy.token));
        for (const leg of position.if_bwLegs || []) {
          if (!leg.closed && leg.token) allTokens.push(Number(leg.token));
        }
      }
    }

    const uniqueTokens = [...new Set(allTokens)];
    const newTokensString = JSON.stringify(uniqueTokens.sort());
    const oldTokensString = JSON.stringify((this.lastTokens || []).sort());

    if (newTokensString === oldTokensString) return;

    this.lastTokens = [...uniqueTokens];
    updateSubscription([...new Set([...uniqueTokens, 256265, 260105])]);
  }

  // =====================
  // CORE ADJUSTMENT LOOP
  // =====================
  async updatePremium() {
    if (!isMarketOpen()) return;

    // ── reset per-tick adjustment flag ──
    for (let position of this.positions) {
      if (position.isClosed) continue;
      if (position.forceExit && !position.isClosed) {
        logger.log("🚨 MAX LOSS — auto closing position");
        await this.recordClosedTrade(position, "MAX_LOSS");
        position.isClosed = true;
        position.isActive = false;
        if (position._id) {
          await PositionModel.findByIdAndUpdate(position._id, {
            isClosed: true,
            isActive: false,
          });
        }
        this.positions = this.positions.filter((p) => !p.isClosed);
        continue;
      }

      // ── Option chain fetch ──
      // Straddle/Strangle always need fresh chain for finding new strikes
      const isStraddle =
        position.strategyType === "INTRADAY_STRADDLE" ||
        position.strategyType === "INTRADAY_STRANGLE";
      const isIronFly = position.strategyType === "IRON_FLY";
      let shouldFetch = true; // always fetch chain — needed for strangle monitoring too

      if (!isStraddle && position.isStrangle && position.basePremium) {
        const trigger = position.basePremium * 1.5;
        if (
          position.currentBuyPrice >= trigger ||
          position.currentSellPrice >= trigger
        ) {
          shouldFetch = true;
        }
      }

      const now = Date.now();
      if (shouldFetch && now - this.lastChainFetch > 10000 && !this._chainFetching) {
        this.lastChainFetch = now;   // claim the slot BEFORE awaiting (prevents concurrent fetches)
        this._chainFetching = true;  // hard re-entry lock across ticks
        try {
          // ── always use fresh token from DB, not stale position.token ──
          const freshUser = await require("../api/models/User").findOne({
            "broker.connected": true,
          });
          const freshToken = freshUser?.broker?.accessToken || position.token;
          this.latestChain = await getOptionChain(
            position.index,
            position.expiry,
            freshToken,
          );
        } catch (err) {
          if (!err.message.includes("Failed to fetch LTP")) {
            logger.log("⚠️ Chain fetch error:", err.message);
          }
        } finally {
          this._chainFetching = false;  // release lock
        }
      }
      // ── Snapshot before adjustment ──
      const beforeAdjustment = JSON.stringify({
        buyToken: position.buyToken,
        sellToken: position.sellToken,
        CE_sell: position.CE_sell,
        PE_sell: position.PE_sell,
        isStrangle: position.isStrangle,
        buyStrike: position.buyStrike,
        sellStrike: position.sellStrike,
        shiftCount: position.shiftCount,
        lossAdjusted: position.lossAdjusted,
        st_legs: position.st_legs,
        st_refFuturePrice: position.st_refFuturePrice,
      });

      if (!position._id) continue;

      const { getTickMap } = require("../services/strategyControllerBridge");
      routeAdjustment(
        position,
        isStraddle || isIronFly
          ? getTickMap()[position.index === "NIFTY" ? 256265 : 260105] ||
              position.st_currentFuturePrice ||
              0
          : position.currentBuyPrice,
        position.pnl,
        this.latestChain,
        getTickMap(),
      );

      const afterAdjustment = JSON.stringify({
        buyToken: position.buyToken,
        sellToken: position.sellToken,
        CE_sell: position.CE_sell,
        PE_sell: position.PE_sell,
        isStrangle: position.isStrangle,
        buyStrike: position.buyStrike,
        sellStrike: position.sellStrike,
        shiftCount: position.shiftCount,
        lossAdjusted: position.lossAdjusted,
        st_legs: position.st_legs,
        st_refFuturePrice: position.st_refFuturePrice,
      });

      const adjustmentChanged = beforeAdjustment !== afterAdjustment;
      // ── if adjustment fired, skip this position for rest of this tick cycle ──
      if (adjustmentChanged) {
        position._adjustedThisTick = true;
      }

      // ── Persist to DB ──
      if (position._id) {
        try {
          await PositionModel.findByIdAndUpdate(position._id, {
            $set: {
              currentBuyPrice: position.currentBuyPrice,
              currentSellPrice: position.currentSellPrice,
              pnl: position.pnl,
              buyQty: position.buyQty,
              sellQty: position.sellQty,
              closedBuyPrice: position.closedBuyPrice,
              closedSellPrice: position.closedSellPrice,
              closedBuyAt: position.closedBuyAt,
              buyStrike: position.buyStrike,
              buyToken: position.buyToken,
              shiftCount: position.shiftCount,
              lossAdjusted: position.lossAdjusted,
              buyClosed: position.buyClosed,
              isStrangle: position.isStrangle,
              forceExit: position.forceExit,
              CE_sell: position.CE_sell,
              PE_sell: position.PE_sell,
              basePremium: position.basePremium,
              isClosed: position.isClosed,
              isActive: position.isActive,
              history: position.history || [],
              otmToken100: position.otmToken100,
              otmToken50: position.otmToken50,
              // ── Straddle / Strangle fields ──
              st_futureToken: position.st_futureToken,
              st_refFuturePrice: position.st_refFuturePrice,
              st_currentFuturePrice: position.st_currentFuturePrice,
              st_realizedPnl: position.st_realizedPnl,
              st_legs: position.st_legs || [],
              closedStrangleLegs: position.closedStrangleLegs || [],
              closedBuyLegs: position.closedBuyLegs || [],
              realizedProfitFromShifts: position.realizedProfitFromShifts || 0,
              // ── Iron fly fields ──
              ...(position.strategyType === "IRON_FLY"
                ? {
                    if_ceSell: position.if_ceSell,
                    if_peSell: position.if_peSell,
                    if_ceBuy: position.if_ceBuy,
                    if_peBuy: position.if_peBuy,
                    if_atmStrike: position.if_atmStrike,
                    if_netPremium: position.if_netPremium,
                    if_upperBreakeven: position.if_upperBreakeven,
                    if_lowerBreakeven: position.if_lowerBreakeven,
                    if_entryIV: position.if_entryIV,
                    if_realizedLoss: position.if_realizedLoss,
                    if_rule1CeFired: position.if_rule1CeFired,
                    if_rule1PeFired: position.if_rule1PeFired,
                    if_bwActive: position.if_bwActive,
                    if_bwLegs: position.if_bwLegs || [],
                    st_futureToken: position.st_futureToken,
                    st_currentFuturePrice: position.st_currentFuturePrice,
                  }
                : {}),
            },
          });
        } catch (err) {
          logger.log("⚠️ Mongo update skipped:", err.message);
        }
      }

      if (adjustmentChanged) {
        logger.log("🔄 Adjustment Detected → Refreshing Tokens");
        const st = position.strategyType;
        // straddle/strangle send their own detailed alert from the engine
        if (st !== "INTRADAY_STRADDLE" && st !== "INTRADAY_STRANGLE") {
          require("../services/notify").sendAlert(`🔄 Adjustment | ${position.index} | position adjusted | PnL ₹${position.pnl}`);
        }
        this.updateTokens();
      }

      await this.checkExit(position, position.pnl);
    }
  }

  // =====================
  // EXIT ENGINE
  // =====================
  async checkExit(position, pnl) {
    if (position.isClosed) return;
    if (!position.maxLossPerLot) return;

    const maxLoss = position.maxLossPerLot * position.quantity;
    const profitTarget = maxLoss * 1.5;

    if (pnl <= -maxLoss) {
      logger.log("❌ STOP LOSS HIT");
      await this.exitPosition(position);
    } else if (pnl >= profitTarget) {
      logger.log("✅ TARGET HIT");
      await this.exitPosition(position);
    }
  }

  async exitPosition(position) {
    if (position.isClosed) return;
    try {
      logger.log("🚪 Starting Exit...");

      const token = position.token;
      const qty = position.quantity;

      const executeExitLeg = async (symbol, type) => {
        // Paper mode: no real broker order is placed. The exit is simulated at
        // the last tracked tick price, so we skip straight to recording it.
        if (position.mode === "paper") return true;

        const MAX_RETRIES = 3;
        for (let i = 0; i < MAX_RETRIES; i++) {
          try {
            const ltpData = await zerodhaService.getLTP(token, [
              `NFO:${symbol}`,
            ]);
            const ltp = ltpData[`NFO:${symbol}`]?.last_price || 1;
            const price =
              type === "BUY"
                ? Math.round(ltp * (1 + 0.002 * (i + 1)) * 20) / 20
                : Math.round(ltp * (1 - 0.002 * (i + 1)) * 20) / 20;

            const order = await zerodhaService.placeOrder(token, {
              tradingsymbol: symbol,
              exchange: "NFO",
              transaction_type: type,
              order_type: "LIMIT",
              quantity: qty,
              product: "NRML",
              price,
            });

            const orderId = order.order_id;
            for (let j = 0; j < 10; j++) {
              const details = await zerodhaService.getOrderDetails(
                token,
                orderId,
              );
              if (details?.status === "COMPLETE") {
                logger.log(`✅ EXIT ${type} COMPLETE`);
                return true;
              }
              await new Promise((r) => setTimeout(r, 500));
            }
            await zerodhaService.cancelOrder(token, orderId);
          } catch (err) {
            logger.log("⚠️ Exit retry:", err.message);
          }
        }
        throw new Error("Exit leg failed");
      };

      if (position.buySymbol) await executeExitLeg(position.buySymbol, "SELL");
      if (position.sellSymbol) await executeExitLeg(position.sellSymbol, "BUY");

      const buyExitPrice = position.currentBuyPrice || position.buyAvgPrice;
      const sellExitPrice = position.currentSellPrice || position.sellAvgPrice;
      const buyPnl = (buyExitPrice - position.buyAvgPrice) * qty;
      const sellPnl = (position.sellAvgPrice - sellExitPrice) * qty;
      const totalPnl = buyPnl + sellPnl;

      await this.recordClosedTrade(position, "TARGET_SL");
      position.isClosed = true;
      if (position._id) {
        await PositionModel.findByIdAndUpdate(position._id, {
          isClosed: true,
          isActive: false,
        });
      }
      this.positions = this.positions.filter((p) => !p.isClosed);
      logger.log("✅ Position Fully Exited");
    } catch (err) {
      logger.log("❌ Exit Error:", err.message);
    }
  }
  // =====================
  // RECORD CLOSED TRADE (strategy-aware) — writes ONE CLOSED Trade doc
  // Called from: forceExit (max loss), exitPosition (target/SL), Exit All
  // =====================
  async recordClosedTrade(position, reason = "EXIT") {
    try {
      // guard: don't write twice for the same position
      if (position._tradeRecorded) return;
      position._tradeRecorded = true;

      const qty = position.quantity || 0;
      let legs = [];
      let netPnl = 0;
      let strategyLabel = position.strategy || position.type || position.strategyType;

      if (
        position.strategyType === "INTRADAY_STRADDLE" ||
        position.strategyType === "INTRADAY_STRANGLE"
      ) {
        // realized (closed legs) + unrealized (open legs at last price)
        netPnl = position.st_realizedPnl || 0;
        for (const leg of position.st_legs || []) {
          const exitPrice = leg.closed
            ? (leg.exitPrice ?? leg.entryPremium)
            : (leg.currentPrice ?? leg.entryPremium);
          const legPnl = ((leg.entryPremium || 0) - (exitPrice || 0)) * qty;
          if (!leg.closed) netPnl += legPnl;
          legs.push({
            symbol: leg.symbol,
            type: "SELL",
            qty,
            entryPrice: leg.entryPremium || 0,
            exitPrice: exitPrice || 0,
            pnl: Number(legPnl.toFixed(2)),
            status: "CLOSED",
          });
        }
      } else if (position.strategyType === "IRON_FLY") {
        const ifLegs = [
          { leg: position.if_ceSell, type: "SELL" },
          { leg: position.if_peSell, type: "SELL" },
          { leg: position.if_ceBuy, type: "BUY" },
          { leg: position.if_peBuy, type: "BUY" },
          ...(position.if_bwLegs || []).map((l) => ({ leg: l, type: l.isBuy ? "BUY" : "SELL" })),
        ];
        for (const { leg, type } of ifLegs) {
          if (!leg) continue;
          const exitPrice = leg.exitPrice ?? leg.currentPrice ?? leg.entryPremium;
          const legPnl = type === "BUY"
            ? ((exitPrice || 0) - (leg.entryPremium || 0)) * qty
            : ((leg.entryPremium || 0) - (exitPrice || 0)) * qty;
          netPnl += legPnl;
          legs.push({
            symbol: leg.symbol,
            type,
            qty,
            entryPrice: leg.entryPremium || 0,
            exitPrice: exitPrice || 0,
            pnl: Number(legPnl.toFixed(2)),
            status: "CLOSED",
          });
        }
      } else {
        // debit spread
        const buyExit = position.currentBuyPrice || position.buyAvgPrice || 0;
        const sellExit = position.currentSellPrice || position.sellAvgPrice || 0;
        const buyPnl = (buyExit - (position.buyAvgPrice || 0)) * qty;
        const sellPnl = ((position.sellAvgPrice || 0) - sellExit) * qty;
        netPnl = buyPnl + sellPnl + (position.realizedProfitFromShifts || 0);
        legs = [
          { symbol: position.buySymbol, type: "BUY", qty, entryPrice: position.buyAvgPrice || 0, exitPrice: buyExit, pnl: Number(buyPnl.toFixed(2)), status: "CLOSED" },
          { symbol: position.sellSymbol, type: "SELL", qty, entryPrice: position.sellAvgPrice || 0, exitPrice: sellExit, pnl: Number(sellPnl.toFixed(2)), status: "CLOSED" },
        ];
      }

      netPnl = Number(netPnl.toFixed(2));

      // ── detailed exit alert (covers all strategies, all exit reasons) ──
      try {
        const lines = legs
          .map(
            (l) =>
              `${l.type} ${l.symbol || ""} @ ${money(l.exitPrice)} (entry ${money(l.entryPrice)} → ${signed(l.pnl)})`,
          )
          .join("\n");
        sendAlert(
          `🚪 ${strategyLabel} EXITED | ${position.index} | reason: ${reason}\n${lines}\nNet P&L: ${signed(netPnl)}`,
        );
      } catch (e) {}

      await Trade.create({
        userId: position.userId,
        strategy: strategyLabel,
        instrument: position.index,
        mode: position.mode || "paper",
        entryTime: position.createdAt || position.entryTime,
        exitTime: new Date(),
        status: "CLOSED",
        legs,
        adjustments:
          position.history?.map((h) => ({
            timestamp: h.time || h.timestamp,
            reason: h.type || h.action,
          })) || [],
        totalPnl: netPnl,
        brokerage: 0,
        charges: 0,
        netPnl,
      });

      logger.log(`📦 CLOSED trade recorded | ${strategyLabel} | netPnl: ${netPnl} | reason: ${reason}`);
    } catch (err) {
      logger.log("❌ recordClosedTrade error:", err.message);
    }
  }
}

module.exports = PositionManager;