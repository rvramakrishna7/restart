const logger = require("../utils/logger");
const positionManager = require("../managers/positionManagerInstance");
const getOptionChain = require("../engine/optionChain");
const findATMStrike = require("../engine/atmFinder");
const findValidSpread = require("../engine/strikeScanner");

const {
  startBullCallSpread,
  startBearPutSpread,
} = require("../engine/positionFactory");

const zerodhaService = require("./zerodhaService");
const User = require("../api/models/User");

// =====================
// UTIL
// =====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = (n) => Number((n || 0).toFixed(2));

function safePrice(price, type) {
  if (!price) return 1;
  let adjusted = type === "BUY" ? price * 1.01 : price * 0.99;
  return Number(adjusted.toFixed(1));
}

// =====================
// POP CALC
// =====================
function calculatePOP({ spot, breakeven, daysToExpiry, iv = 0.18 }) {
  try {
    const T = daysToExpiry / 365;
    if (T <= 0) return 0;

    const z = Math.log(breakeven / spot) / (iv * Math.sqrt(T));
    const cdf = 0.5 * (1 + erf(z / Math.sqrt(2)));

    return Math.max(0, Math.min(1, 1 - cdf));
  } catch {
    return 0.5;
  }
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

function getDaysToExpiry(expiry) {
  const today = new Date();
  const exp = new Date(expiry);
  return Math.max(1, Math.ceil((exp - today) / (1000 * 60 * 60 * 24)));
}

// =====================
// ORDER HELPERS
// =====================
async function placeWithRetry(token, params, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await zerodhaService.placeOrder(token, params);
    } catch (err) {
      logger.log(`⚠️ Retry ${i + 1}:`, err.message);
      await sleep(500);
    }
  }
  throw new Error("Order failed");
}

async function waitForFill(token, orderId) {
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const status = await zerodhaService.getOrderStatus(token, orderId);

    if (status === "COMPLETE") return true;
    if (status === "REJECTED" || status === "CANCELLED") return false;
  }
  return false;
}

// =====================
// EXECUTE
// =====================
async function executeStrategy({
  instrument,
  direction,
  userId,
  lots,
  expiry,
  preview,
  mode = "live",
}) {
  const user = await User.findById(userId);

  if (!user?.broker?.accessToken) {
    throw new Error("Broker not connected");
  }

  const token = user.broker.accessToken;

  // =====================
  // FORMAT EXPIRY
  // =====================
  let formattedExpiry = expiry;
  if (typeof expiry === "object" && expiry?.date) {
    formattedExpiry = new Date(expiry.date).toISOString().split("T")[0];
  }

  // =====================
  // OPTION CHAIN
  // =====================
  const chain = await getOptionChain(instrument, formattedExpiry, token);

  const strikes = chain.map((o) => o.strike);

  const spot = await zerodhaService.getSpotPrice(token, instrument);
  const atm = findATMStrike(spot, strikes);

  const premiums = {};
  chain.forEach((o) => {
    premiums[o.strike] = direction === "BULLISH" ? o.CE : o.PE;
  });

  const spreads = findValidSpread(strikes, premiums, direction, atm);
  if (!spreads.length) return { message: "No trade" };

  const spread = spreads[0];

  // =====================
  // LOT SIZE
  // =====================
  const buyOption = chain.find((o) => o.strike === spread.buyStrike);

  let lotSize = buyOption?.lot_size;
  if (!lotSize || lotSize < 10) {
    // SAFE FALLBACK FROM INSTRUMENT
    if (instrument === "NIFTY") {
      lotSize = 65;
    } else if (instrument === "BANKNIFTY") {
      lotSize = 30;
    } else {
      lotSize = 1;
    }

    logger.log("⚠️ Using fallback lot size:", lotSize);
  }

  const qty = lotSize * (lots || 1);

  // =====================
  // METRICS (FIXED)
  // =====================
  spread.maxLoss = spread.netPremium * qty;
  spread.maxProfit =
    Math.abs(spread.sellStrike - spread.buyStrike) * qty - spread.maxLoss;

  spread.rr = spread.maxLoss > 0 ? spread.maxProfit / spread.maxLoss : 0;

  const days = getDaysToExpiry(formattedExpiry);

  const pop = calculatePOP({
    spot,
    breakeven: spread.breakeven,
    daysToExpiry: days,
  });

  spread.pop = r(pop * 100);

  // =====================
  // ROUND EVERYTHING
  // =====================
  spread.buyPremium = r(spread.buyPremium);
  spread.sellPremium = r(spread.sellPremium);
  spread.netPremium = r(spread.netPremium);
  spread.maxProfit = r(spread.maxProfit);
  spread.maxLoss = r(spread.maxLoss);
  spread.breakeven = r(spread.breakeven);
  spread.rr = r(spread.rr);

  const buySymbol =
    direction === "BULLISH" ? buyOption.CE_symbol : buyOption.PE_symbol;

  const sellOption = chain.find((o) => o.strike === spread.sellStrike);

  const sellSymbol =
    direction === "BULLISH" ? sellOption.CE_symbol : sellOption.PE_symbol;


  // =====================
  // MARGIN (REAL ZERODHA BASKET )
  // =====================
  let marginValue = 0;

  try {
    const margin = await zerodhaService.getBasketMargin(token, [
      {
        exchange: "NFO",
        tradingsymbol: buySymbol,
        transaction_type: "BUY",
        quantity: qty,
        product: "NRML",
        order_type: "MARKET", // ✅ MUST
        price: 0, // ✅ MUST
      },
      {
        exchange: "NFO",
        tradingsymbol: sellSymbol,
        transaction_type: "SELL",
        quantity: qty,
        product: "NRML",
        order_type: "MARKET", // ✅ MUST
        price: 0, // ✅ MUST
      },
    ]);

    // CORRECT CALCULATION
    if (Array.isArray(margin)) {
      marginValue = margin.reduce((sum, leg) => {
        return sum + (leg.total || 0);
      }, 0);
    } else if (margin?.initial?.total) {
      marginValue = margin.initial.total;
    }
  } catch (err) {
    logger.log("⚠️ Margin fetch failed:", err.message);
  }

  spread.margin = r(marginValue);
  spread.quantity = qty;
  spread.lotSize = lotSize;
  spread.lots = lots || 1;
  spread.index = instrument;
  // =====================
  // PREVIEW MODE
  // =====================
  if (preview) {
    return { spread };
  }

  const hour = new Date().getHours();
  if (mode === "live" && (hour < 9 || hour > 15)) {
    logger.log("⚠️ Market closed — execution skipped");
    return { spread, message: "Market closed" };
  }

  // =====================
  // EXECUTION
  // =====================

  const ltpData = await zerodhaService.getLTP(token, [
    `NFO:${buySymbol}`,
    `NFO:${sellSymbol}`,
  ]);

  const buyLTP = ltpData[`NFO:${buySymbol}`]?.last_price || 1;
  const sellLTP = ltpData[`NFO:${sellSymbol}`]?.last_price || 1;

  // =====================
  // IMPROVED EXECUTION ENGINE (FINAL STABLE)
  // =====================

  // GLOBAL LOCK (prevents duplicate execution across calls)
  if (!global.__isExecuting) {
    global.__isExecuting = false;
  }

  function getAdaptivePrice(price, type, attempt) {
    if (!price) return 1;

    const buffer = Math.max(0.5, price * 0.01);

    let adjusted =
      type === "BUY"
        ? price + buffer * (attempt + 1)
        : price - buffer * (attempt + 1);

    return Number(adjusted.toFixed(1));
  }

  // WAIT FOR FINAL STATUS (polling instead of fixed sleep)
  async function waitForFinalStatus(token, orderId) {
    const MAX_CHECKS = 8;

    for (let i = 0; i < MAX_CHECKS; i++) {
      const details = await zerodhaService.getOrderDetails(token, orderId);

      const status = details?.status;

      if (status === "COMPLETE") return details;
      if (status === "REJECTED" || status === "CANCELLED") return details;

      await sleep(700);
    }

    return null;
  }

  // strict execution per leg
  async function executeLeg(token, params, symbol, type, mode) {
    // =====================
    // PAPER MODE (SIMULATION)
    // =====================
    if (mode === "paper") {
      const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
      const ltp = ltpData[`NFO:${symbol}`]?.last_price || 1;

      logger.log(`🧪 PAPER ${type} EXECUTED @ ${ltp}`);

      return {
        success: true,
        orderId: `paper_${Date.now()}`,
        avgPrice: ltp,
        status: "COMPLETE",
      };
    }

    // =====================
    // LIVE MODE (UNCHANGED)
    // =====================
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
        const ltp = ltpData[`NFO:${symbol}`]?.last_price || 1;

        const price = getAdaptivePrice(ltp, type, i);

        logger.log(`⚡ ${type} Attempt ${i + 1} @ ${price}`);

        const order = await zerodhaService.placeOrder(token, {
          ...params,
          price,
        });

        const orderId = order.order_id;

        const details = await waitForFinalStatus(token, orderId);

        if (!details) continue;

        const status = details.status;
        const filledQty = details.filled_quantity || 0;

        if (status === "COMPLETE") {
          return {
            success: true,
            orderId,
            avgPrice: details.average_price,
            status: "COMPLETE",
          };
        }

        if (filledQty > 0 && filledQty < params.quantity) {
          await zerodhaService.cancelOrder(token, orderId);
        }

        if (status === "OPEN" || status === "TRIGGER PENDING") {
          await zerodhaService.cancelOrder(token, orderId);
        }
      } catch (err) {
        logger.log(`⚠️ ${type} retry ${i + 1}:`, err.message);
      }

      await sleep(800);
    }

    return {
      success: false,
      status: "FAILED",
    };
  }

  // =====================
  // EXECUTION FLOW (STRICT ORDER)
  // =====================

  try {
    logger.log("🚀 Starting BUY leg...");

    const buyResult = await executeLeg(
      token,
      {
        tradingsymbol: buySymbol,
        exchange: "NFO",
        transaction_type: "BUY",
        order_type: "LIMIT",
        quantity: qty,
        product: "NRML",
      },
      buySymbol,
      "BUY",
      mode,
    );

    if (!buyResult.success) {
      throw new Error("BUY failed");
    }

    logger.log("🚀 BUY confirmed → placing SELL...");

    const sellResult = await executeLeg(
      token,
      {
        tradingsymbol: sellSymbol,
        exchange: "NFO",
        transaction_type: "SELL",
        order_type: "LIMIT",
        quantity: qty,
        product: "NRML",
      },
      sellSymbol,
      "SELL",
      mode,
    );

    if (!sellResult.success) {
      throw new Error("SELL failed");
    }

    logger.log("✅ Spread fully executed");

    // =====================
    // START STRATEGY
    // =====================
    let position;
    spread.lots = lots || 1;
    spread.quantity = qty;
    spread.lotSize = lotSize;
    spread.index = instrument;

    if (direction === "BULLISH") {
      position = startBullCallSpread(null, spread, strikes, premiums);
    } else {
      position = startBearPutSpread(null, spread, strikes, premiums);
    }

    if (position) {
      position.token = token;
      position.expiry = formattedExpiry;
      position.index = instrument;
      position.buySymbol = buySymbol;
      position.sellSymbol = sellSymbol;

      position.buyToken =
        direction === "BULLISH"
          ? Number(buyOption.CE_token)
          : Number(buyOption.PE_token);

      position.sellToken =
        direction === "BULLISH"
          ? Number(sellOption.CE_token)
          : Number(sellOption.PE_token);
      logger.log("OPTION TOKENS:", {
        buyToken: position.buyToken,
        sellToken: position.sellToken,
      });

      position.orderIds = {
        buy: buyResult.orderId,
        sell: sellResult.orderId,
      };

      position.orderStatus = {
        buy: "COMPLETE",
        sell: "COMPLETE",
      };

      position.buyAvgPrice = buyResult.avgPrice;
      position.sellAvgPrice = sellResult.avgPrice;
      position.lots = lots || 1;
      position.quantity = qty;
      position.lotSize = lotSize;
      position.mode = mode;
      position.margin = spread.margin;
      position.userId = userId;

      // store OTM tokens for immediate WS subscription
      const isBullDir = direction === "BULLISH";
      const otmOpt100 = chain.find(
        (o) =>
          o.strike ===
          (isBullDir ? spread.buyStrike + 100 : spread.buyStrike - 100),
      );
      const otmOpt50 = chain.find(
        (o) =>
          o.strike ===
          (isBullDir ? spread.buyStrike + 50 : spread.buyStrike - 50),
      );
      position.otmToken100 = otmOpt100
        ? Number(isBullDir ? otmOpt100.CE_token : otmOpt100.PE_token)
        : null;
      position.otmToken50 = otmOpt50
        ? Number(isBullDir ? otmOpt50.CE_token : otmOpt50.PE_token)
        : null;

      await positionManager.addPosition(position);

      logger.log(
        "POSITION AFTER ADD:",
        positionManager.positions.map((p) => ({
          buyToken: p.buyToken,
          sellToken: p.sellToken,
        })),
      );

      positionManager.updateTokens();
    }

    return { spread };
  } catch (err) {
    logger.log("❌ Execution error:", err.message);
    throw err;
  }
}

// =====================
// EXPORTS
// =====================
function getPositions() {
  return positionManager.getPositions();
}


// =====================
// EXECUTE STRADDLE
// =====================
async function executeStraddle({
  instrument,
  userId,
  lots,
  expiry,
  mode = "paper",
}) {
  const user = await User.findById(userId);
  if (!user?.broker?.accessToken) throw new Error("Broker not connected");

  const token = user.broker.accessToken;

  // format expiry
  let formattedExpiry = expiry;
  if (typeof expiry === "object" && expiry?.date) {
    formattedExpiry = new Date(expiry.date).toISOString().split("T")[0];
  }

  // get option chain and spot price
  const chain = await getOptionChain(instrument, formattedExpiry, token);
  const spot  = await zerodhaService.getSpotPrice(token, instrument);

  // ── ATM rounding: NIFTY  nearest 50, BANKNIFTY  nearest 100 ──
  const step    = instrument === "NIFTY" ? 50 : 100;
  const atmStrike = Math.round(spot / step) * step;

  const atmOption = chain.find((o) => o.strike === atmStrike);
  if (!atmOption) throw new Error(`ATM strike ${atmStrike} not found in chain`);

  const ceSymbol = atmOption.CE_symbol;
  const peSymbol = atmOption.PE_symbol;
  const ceToken  = Number(atmOption.CE_token);
  const peToken  = Number(atmOption.PE_token);

  // lot size
  let lotSize = atmOption.lot_size;
  if (!lotSize || lotSize < 10) {
    lotSize = instrument === "NIFTY" ? 65 : 30;
    logger.log("⚠️ Straddle fallback lot size:", lotSize);
  }
  const qty = lotSize * (lots || 1);
  // ── market hours check — live mode only ──
  const hour = new Date().getHours();
  if (mode === "live" && (hour < 9 || hour > 15)) {
    logger.log("⚠️ Market closed — straddle execution skipped");
    return { message: "Market closed" };
  }
  logger.log(`🎯 STRADDLE ENTRY | ${instrument} | ATM: ${atmStrike} | CE: ${ceSymbol} | PE: ${peSymbol} | qty: ${qty}`);

  // ── execute CE SELL ──
  const ceResult = await executeLegSell(token, ceSymbol, qty, mode);
  if (!ceResult.success) throw new Error("CE SELL failed");

  // ── execute PE SELL ──
  const peResult = await executeLegSell(token, peSymbol, qty, mode);
  if (!peResult.success) throw new Error("PE SELL failed");

  logger.log(`✅ Straddle executed | CE @ ${ceResult.avgPrice} | PE @ ${peResult.avgPrice}`);
  require("./notify").sendAlert(`🎯 STRADDLE entered | ${instrument} | ATM ${atmStrike} | qty ${qty}`);
  const entryPremium = (ceResult.avgPrice || 0) + (peResult.avgPrice || 0);

  // ── build position ──
  const position = {
    strategyType:          "INTRADAY_STRADDLE",
    index:                 instrument,
    expiry:                formattedExpiry,
    token,
    mode,
    lots:                  lots || 1,
    lotSize,
    quantity:              qty,
    isActive:              true,
    isClosed:              false,
    forceExit:             false,
    pnl:                   0,
    history:               [],

    // straddle specific
    st_entryFuturePrice:   spot,
    st_refFuturePrice:     spot,
    st_currentFuturePrice: spot,
    st_entryPremium:       entryPremium,
    st_realizedPnl:        0,
    st_futureToken:        instrument === "NIFTY" ? 256265 : 260105,

    st_legs: [
      {
        type:         "CE",
        strike:       atmStrike,
        entryPremium: ceResult.avgPrice || 0,
        currentPrice: ceResult.avgPrice || 0,
        token:        ceToken,
        symbol:       ceSymbol,
        closed:       false,
        openedAt:     new Date().toISOString(),
      },
      {
        type:         "PE",
        strike:       atmStrike,
        entryPremium: peResult.avgPrice || 0,
        currentPrice: peResult.avgPrice || 0,
        token:        peToken,
        symbol:       peSymbol,
        closed:       false,
        openedAt:     new Date().toISOString(),
      },
    ],
  };

  await positionManager.addPosition(position);
  logger.log("💾 Straddle position saved");

  return {
    atmStrike,
    ceSymbol,
    peSymbol,
    cePremium:      ceResult.avgPrice,
    pePremium:      peResult.avgPrice,
    entryPremium,
    quantity:       qty,
    lotSize,
    lots:           lots || 1,
  };
}

// ── shared SELL leg executor for straddle/strangle ──
async function executeLegSell(token, symbol, qty, mode) {
  if (mode === "paper") {
    const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
    const ltp     = ltpData[`NFO:${symbol}`]?.last_price || 1;
    logger.log(`🧪 PAPER SELL ${symbol} @ ${ltp}`);
    return { success: true, orderId: `paper_${Date.now()}`, avgPrice: ltp };
  }

  // live
  for (let i = 0; i < 3; i++) {
    try {
      const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
      const ltp     = ltpData[`NFO:${symbol}`]?.last_price || 1;
      const price   = Number((ltp * 0.99).toFixed(1));

      const order   = await zerodhaService.placeOrder(token, {
        tradingsymbol:    symbol,
        exchange:         "NFO",
        transaction_type: "SELL",
        order_type:       "LIMIT",
        quantity:         qty,
        product:          "NRML",
        price,
      });

      const orderId = order.order_id;
      for (let j = 0; j < 8; j++) {
        await sleep(700);
        const details = await zerodhaService.getOrderDetails(token, orderId);
        if (details?.status === "COMPLETE") {
          return { success: true, orderId, avgPrice: details.average_price };
        }
        if (details?.status === "REJECTED" || details?.status === "CANCELLED") break;
      }
    } catch (err) {
      logger.log(`⚠️ SELL retry ${i + 1}:`, err.message);
    }
    await sleep(800);
  }
  return { success: false };
}

// =====================
// EXECUTE STRANGLE
// =====================
async function executeStrangle({
  instrument,
  userId,
  lots,
  expiry,
  mode = "paper",
}) {
  const user = await User.findById(userId);
  if (!user?.broker?.accessToken) throw new Error("Broker not connected");

  const token = user.broker.accessToken;

  let formattedExpiry = expiry;
  if (typeof expiry === "object" && expiry?.date) {
    formattedExpiry = new Date(expiry.date).toISOString().split("T")[0];
  }

  const chain = await getOptionChain(instrument, formattedExpiry, token);
  const spot  = await zerodhaService.getSpotPrice(token, instrument);

  // ── minimum distance from spot ──
  const isBnf    = instrument === "BANKNIFTY";
  const minDist  = isBnf ? 600 : 200;

  // ── find CE: minimum minDist above spot, closest premium match to PE side ──
 const strikeStep  = isBnf ? 100 : 50;
  const ceMinStrike = Math.floor((spot + minDist) / strikeStep) * strikeStep;
  const peMaxStrike = Math.ceil((spot - minDist) / strikeStep) * strikeStep;

// ── three-tier premium preference ──
  // NIFTY:     Tier1 >= 100, Tier2 >= 75, Tier3 >= 50
  // BANKNIFTY: Tier1 >= 200, Tier2 >= 150, Tier3 >= 100
  const premiumTiers = isBnf ? [200, 150, 100] : [100, 75, 50];

  // ── helper: find best CE/PE pair at given minimum premium ──
  function findBestPair(minPrem) {
    const ceList = chain
      .filter((o) => o.strike >= ceMinStrike && o.CE >= minPrem && o.CE_token)
      .sort((a, b) => a.strike - b.strike);
    const peList = chain
      .filter((o) => o.strike <= peMaxStrike && o.PE >= minPrem && o.PE_token)
      .sort((a, b) => b.strike - a.strike);

    if (!ceList.length || !peList.length) return null;

    let best = null;
    let bestDiff = Infinity;
    for (const ce of ceList) {
      for (const pe of peList) {
        const diff = Math.abs(ce.CE - pe.PE);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = { ce, pe };
        }
      }
    }
    return best;
  }

  // ── try each tier in order ──
  let bestPair = null;
  for (const tier of premiumTiers) {
    bestPair = findBestPair(tier);
    if (bestPair) {
      logger.log(`✅ STRANGLE: found pair at tier >= ${tier}`);
      break;
    }
  }

  if (!bestPair) {
    return { message: "No trade" }; // triggers "Discipline > Opportunity" in UI
  }

  const bestCE = bestPair.ce;
  const bestPE = bestPair.pe;

  const ceSymbol = bestCE.CE_symbol;
  const peSymbol = bestPE.PE_symbol;
  const ceToken  = Number(bestCE.CE_token);
  const peToken  = Number(bestPE.PE_token);

  let lotSize = bestCE.lot_size;
  if (!lotSize || lotSize < 10) {
    lotSize = isBnf ? 30 : 65;
    logger.log("⚠️ Strangle fallback lot size:", lotSize);
  }
  const qty = lotSize * (lots || 1);
  // ── market hours check — live mode only ──
  const hour = new Date().getHours();
  if (mode === "live" && (hour < 9 || hour > 15)) {
    logger.log("⚠️ Market closed — strangle execution skipped");
    return { message: "Market closed" };
  }
  logger.log(`🎯 STRANGLE ENTRY | ${instrument} | CE: ${bestCE.strike}@${bestCE.CE} | PE: ${bestPE.strike}@${bestPE.PE} | dist: ${minDist}pts | qty: ${qty}`);

  const ceResult = await executeLegSell(token, ceSymbol, qty, mode);
  if (!ceResult.success) throw new Error("CE SELL failed");

  const peResult = await executeLegSell(token, peSymbol, qty, mode);
  if (!peResult.success) throw new Error("PE SELL failed");

  logger.log(`✅ Strangle executed | CE ${bestCE.strike}@${ceResult.avgPrice} | PE ${bestPE.strike}@${peResult.avgPrice}`);
  require("./notify").sendAlert(`🎯 STRANGLE entered | ${instrument} | ATM ${atmStrike} | qty ${qty}`);
  const position = {
    strategyType:          "INTRADAY_STRANGLE",
    index:                 instrument,
    expiry:                formattedExpiry,
    token,
    mode,
    lots:                  lots || 1,
    lotSize,
    quantity:              qty,
    isActive:              true,
    isClosed:              false,
    forceExit:             false,
    pnl:                   0,
    history:               [],

    st_entryFuturePrice:   spot,
    st_refFuturePrice:     spot,
    st_currentFuturePrice: spot,
    st_entryPremium:       (ceResult.avgPrice || 0) + (peResult.avgPrice || 0),
    st_realizedPnl:        0,
    st_futureToken:        isBnf ? 260105 : 256265,

    st_legs: [
      {
        type:         "CE",
        strike:       bestCE.strike,
        entryPremium: ceResult.avgPrice || 0,
        currentPrice: ceResult.avgPrice || 0,
        token:        ceToken,
        symbol:       ceSymbol,
        closed:       false,
        openedAt:     new Date().toISOString(),
      },
      {
        type:         "PE",
        strike:       bestPE.strike,
        entryPremium: peResult.avgPrice || 0,
        currentPrice: peResult.avgPrice || 0,
        token:        peToken,
        symbol:       peSymbol,
        closed:       false,
        openedAt:     new Date().toISOString(),
      },
    ],
  };

  await positionManager.addPosition(position);
  logger.log("💾 Strangle position saved");

  return {
    ceStrike:    bestCE.strike,
    peStrike:    bestPE.strike,
    ceSymbol,
    peSymbol,
    cePremium:   ceResult.avgPrice,
    pePremium:   peResult.avgPrice,
    combined:    (ceResult.avgPrice || 0) + (peResult.avgPrice || 0),
    quantity:    qty,
    lotSize,
    lots:        lots || 1,
    minDist,
  };
}


// =====================
// EXECUTE IRON FLY
// =====================
async function executeIronFly({
  instrument,
  userId,
  lots,
  expiry,
  mode = "paper",
}) {
  const user = await User.findById(userId);
  if (!user?.broker?.accessToken) throw new Error("Broker not connected");

  const token = user.broker.accessToken;

  let formattedExpiry = expiry;
  if (typeof expiry === "object" && expiry?.date) {
    formattedExpiry = new Date(expiry.date).toISOString().split("T")[0];
  }

  // ── market hours check — live mode only (3:20 PM entry window) ──
  const now  = new Date();
  const hour = now.getHours();
  const min  = now.getMinutes();
  if (mode === "live") {
    const afterOpen  = hour > 9 || (hour === 9 && min >= 15);
    const beforeClose = hour < 15 || (hour === 15 && min <= 35);
    if (!afterOpen || !beforeClose) {
      logger.log("⚠️ Market closed — iron fly execution skipped");
      return { message: "Market closed" };
    }
  }

  const chain = await getOptionChain(instrument, formattedExpiry, token);
  const spot  = await zerodhaService.getSpotPrice(token, instrument);

  const isBnf    = instrument === "BANKNIFTY";
  const step     = isBnf ? 100 : 50;
  const atmStrike = Math.round(spot / step) * step;
  const atmOption = chain.find((o) => o.strike === atmStrike);
  if (!atmOption) throw new Error(`ATM strike ${atmStrike} not found in chain`);

  const ceSellPrem = atmOption.CE || 0;
  const peSellPrem = atmOption.PE || 0;
  const combined   = ceSellPrem + peSellPrem;

  // ── check minimum combined premium ──
  // ── check minimum combined premium ──
  const { IRON_FLY } = require("../config/constants");
  // BANKNIFTY has only monthly expiry
  // NIFTY: weekly = expiry within 8 days, monthly = beyond 8 days
  const daysToExp   = Math.ceil((new Date(formattedExpiry) - now) / (1000 * 60 * 60 * 24));
  const isWeekly    = !isBnf && daysToExp <= 8;
  const minCombined = isBnf
    ? IRON_FLY.MIN_COMBINED_PREMIUM.BANKNIFTY.monthly
    : isWeekly
      ? IRON_FLY.MIN_COMBINED_PREMIUM.NIFTY.weekly
      : IRON_FLY.MIN_COMBINED_PREMIUM.NIFTY.monthly;

  if (combined < minCombined) {
    logger.log(`⚠️ IRON FLY: combined ${combined} < min ${minCombined} → no trade`);
    return { message: "No trade" };
  }

  // ── wing distance: FULL combined premium away from ATM, rounded to strike step ──
  const wingStep    = isBnf ? 100 : 50;
  const wingDist    = Math.round(combined / wingStep) * wingStep;
  const ceBuyStrike = atmStrike + wingDist;
  const peBuyStrike = atmStrike - wingDist;

  const ceBuyOption = chain.find((o) => o.strike === ceBuyStrike);
  const peBuyOption = chain.find((o) => o.strike === peBuyStrike);
  if (!ceBuyOption || !peBuyOption) throw new Error("Wing strikes not found in chain");

  const ceBuyPrem  = ceBuyOption.CE || 0;
  const peBuyPrem  = peBuyOption.PE || 0;
  const netPremium = Number((combined - ceBuyPrem - peBuyPrem).toFixed(2));
  const upperBE    = Number((atmStrike + netPremium).toFixed(0));
  const lowerBE    = Number((atmStrike - netPremium).toFixed(0));

  let lotSize = atmOption.lot_size;
  if (!lotSize || lotSize < 10) {
    lotSize = isBnf ? 30 : 65;
    logger.log("⚠️ Iron fly fallback lot size:", lotSize);
  }
  const qty = lotSize * (lots || 1);

  // ── back-calculate IV from ATM CE for BS model ──
  const T = Math.max((new Date(formattedExpiry) - now) / (1000 * 60 * 60 * 24 * 365), 0.001);
  let entryIV = isBnf ? 0.18 : 0.15;
  try {
    // simple IV approximation from ATM premium
    entryIV = (ceSellPrem / spot) * Math.sqrt(365 / Math.max(T * 365, 1)) * 2.5;
    entryIV = Math.min(Math.max(entryIV, 0.05), 1.5);
  } catch { entryIV = isBnf ? 0.18 : 0.15; }

  logger.log(`🎯 IRON FLY ENTRY | ${instrument} | ATM: ${atmStrike} | sell CE+PE @ ${ceSellPrem}+${peSellPrem} | buy CE${ceBuyStrike}@${ceBuyPrem} PE${peBuyStrike}@${peBuyPrem} | net: ${netPremium} | BE: ${lowerBE}-${upperBE}`);

  // ── execute 4 legs ──
  const ceSellResult = await executeLegSell(token, atmOption.CE_symbol, qty, mode);
  if (!ceSellResult.success) throw new Error("CE SELL failed");

  const peSellResult = await executeLegSell(token, atmOption.PE_symbol, qty, mode);
  if (!peSellResult.success) throw new Error("PE SELL failed");

  const ceBuyResult = await executeLegBuy(token, ceBuyOption.CE_symbol, qty, mode);
  if (!ceBuyResult.success) throw new Error("CE BUY failed");

  const peBuyResult = await executeLegBuy(token, peBuyOption.PE_symbol, qty, mode);
  if (!peBuyResult.success) throw new Error("PE BUY failed");

  logger.log(`✅ Iron fly executed | CE sell@${ceSellResult.avgPrice} PE sell@${peSellResult.avgPrice} CE buy@${ceBuyResult.avgPrice} PE buy@${peBuyResult.avgPrice}`);
  require("./notify").sendAlert(`🎯 IRON FLY entered | ${instrument} | ATM ${atmStrike} | qty ${qty}`);
  const position = {
    strategyType:      "IRON_FLY",
    index:             instrument,
    expiry:            formattedExpiry,
    token,
    mode,
    lots:              lots || 1,
    lotSize,
    quantity:          qty,
    isActive:          true,
    isClosed:          false,
    forceExit:         false,
    pnl:               0,
    history:           [],

    // ── iron fly specific ──
    if_atmStrike:        atmStrike,
    if_netPremium:       netPremium,
    if_upperBreakeven:   upperBE,
    if_lowerBreakeven:   lowerBE,
    if_entryIV:          entryIV,
    if_realizedLoss:     0,
    if_rule1CeFired:     false,
    if_rule1PeFired:     false,
    if_bwActive:         false,
    if_bwLegs:           [],

    if_ceSell: {
      strike:       atmStrike,
      entryPremium: ceSellResult.avgPrice || 0,
      currentPrice: ceSellResult.avgPrice || 0,
      token:        Number(atmOption.CE_token),
      symbol:       atmOption.CE_symbol,
      openedAt:     new Date().toISOString(),
    },
    if_peSell: {
      strike:       atmStrike,
      entryPremium: peSellResult.avgPrice || 0,
      currentPrice: peSellResult.avgPrice || 0,
      token:        Number(atmOption.PE_token),
      symbol:       atmOption.PE_symbol,
      openedAt:     new Date().toISOString(),
    },
    if_ceBuy: {
      strike:       ceBuyStrike,
      entryPremium: ceBuyResult.avgPrice || 0,
      currentPrice: ceBuyResult.avgPrice || 0,
      token:        Number(ceBuyOption.CE_token),
      symbol:       ceBuyOption.CE_symbol,
      closed:       false,
      openedAt:     new Date().toISOString(),
    },
    if_peBuy: {
      strike:       peBuyStrike,
      entryPremium: peBuyResult.avgPrice || 0,
      currentPrice: peBuyResult.avgPrice || 0,
      token:        Number(peBuyOption.PE_token),
      symbol:       peBuyOption.PE_symbol,
      closed:       false,
      openedAt:     new Date().toISOString(),
    },

    // futures token for tick price
    st_futureToken:        isBnf ? 260105 : 256265,
    st_currentFuturePrice: spot,
  };

  await positionManager.addPosition(position);
  logger.log("💾 Iron fly position saved");

  return {
    atmStrike,
    ceSellPrem:  ceSellResult.avgPrice,
    peSellPrem:  peSellResult.avgPrice,
    ceBuyStrike,
    peBuyStrike,
    ceBuyPrem:   ceBuyResult.avgPrice,
    peBuyPrem:   peBuyResult.avgPrice,
    netPremium,
    upperBE,
    lowerBE,
    quantity:    qty,
    lotSize,
    lots:        lots || 1,
  };
}

// ── shared BUY leg executor for iron fly wings ──
async function executeLegBuy(token, symbol, qty, mode) {
  if (mode === "paper") {
    const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
    const ltp     = ltpData[`NFO:${symbol}`]?.last_price || 1;
    logger.log(`🧪 PAPER BUY ${symbol} @ ${ltp}`);
    return { success: true, orderId: `paper_${Date.now()}`, avgPrice: ltp };
  }

  // live
  for (let i = 0; i < 3; i++) {
    try {
      const ltpData = await zerodhaService.getLTP(token, [`NFO:${symbol}`]);
      const ltp     = ltpData[`NFO:${symbol}`]?.last_price || 1;
      const price   = Number((ltp * 1.01).toFixed(1));

      const order = await zerodhaService.placeOrder(token, {
        tradingsymbol:    symbol,
        exchange:         "NFO",
        transaction_type: "BUY",
        order_type:       "LIMIT",
        quantity:         qty,
        product:          "NRML",
        price,
      });

      const orderId = order.order_id;
      for (let j = 0; j < 8; j++) {
        await sleep(700);
        const details = await zerodhaService.getOrderDetails(token, orderId);
        if (details?.status === "COMPLETE") {
          return { success: true, orderId, avgPrice: details.average_price };
        }
        if (details?.status === "REJECTED" || details?.status === "CANCELLED") break;
      }
    } catch (err) {
      logger.log(`⚠️ BUY retry ${i + 1}:`, err.message);
    }
    await sleep(800);
  }
  return { success: false };
}

module.exports = {
  executeStrategy,
  executeStraddle,
  executeStrangle,
  executeIronFly,
  getPositions,
};