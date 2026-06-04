const logger = require("../utils/logger");
const KiteConnect = require("kiteconnect").KiteConnect;
const { ZERODHA_API_KEY, ZERODHA_API_SECRET } = require("../config/env");

const apiKey    = ZERODHA_API_KEY;
const apiSecret = ZERODHA_API_SECRET;

// =====================
// BASE INSTANCE
// =====================
const kite = new KiteConnect({
  api_key: apiKey
});

// =====================
// LOGIN URL (FIXED)
// =====================
exports.getLoginUrl = () => {
  return kite.getLoginURL();
};

// =====================
// GENERATE SESSION
// =====================
exports.generateSession = async (requestToken) => {
  return await kite.generateSession(requestToken, apiSecret);
};

// =====================
// CREATE AUTH INSTANCE
// =====================
const getKiteInstance = (accessToken) => {
  return new KiteConnect({
    api_key: apiKey,
    access_token: accessToken
  });
};

// =====================
// GET SPOT PRICE
// =====================
exports.getSpotPrice = async (accessToken, instrument) => {
  const kiteInstance = getKiteInstance(accessToken);

  let symbol;

  if (instrument === "NIFTY") {
    symbol = "NSE:NIFTY 50";
  } else if (instrument === "BANKNIFTY") {
    symbol = "NSE:NIFTY BANK";
  } else {
    throw new Error("Invalid instrument");
  }

  const quote = await kiteInstance.getQuote([symbol]);

  if (!quote[symbol]) {
    throw new Error("Spot price not found");
  }

  return quote[symbol].last_price;
};

// =====================
// GET BASKET MARGIN (UNCHANGED)
// =====================
exports.getBasketMargin = async (accessToken, orders) => {
  const kiteInstance = getKiteInstance(accessToken);

  const formattedOrders = orders.map(o => ({
    exchange: o.exchange,
    tradingsymbol: o.tradingsymbol,
    transaction_type: o.transaction_type,
    product: o.product,
    order_type: "LIMIT", // ⚠️ kept as-is per your rule
    quantity: o.quantity,
    price: 0
  }));

  const response = await kiteInstance.orderMargins(formattedOrders);

  return response;
};

// =====================
// GET POSITIONS
// =====================
exports.getPositions = async (accessToken) => {
  const kiteInstance = getKiteInstance(accessToken);
  return await kiteInstance.getPositions();
};

// =====================
// GET INSTRUMENTS
// =====================
exports.getInstruments = async () => {
  const kiteInstance = new KiteConnect({
    api_key: apiKey
  });

  return await kiteInstance.getInstruments("NFO");
};

// =====================
// GET LTP (SAFE)
// =====================
exports.getLTP = async (accessToken, symbols) => {
  const kiteInstance = getKiteInstance(accessToken);
  return await kiteInstance.getQuote(symbols);
};

// =====================
// PLACE ORDER (UNCHANGED CORE)
// =====================
exports.placeOrder = async (accessToken, orderParams) => {
  try {
    const kiteInstance = getKiteInstance(accessToken);

    const response = await kiteInstance.placeOrder(
      "regular",
      orderParams
    );

    return response;

  } catch (err) {
    logger.error("ORDER ERROR:", err.message);
    throw err;
  }
};

// =====================
// GET ORDER STATUS (EXISTING)
// =====================
exports.getOrderStatus = async (accessToken, orderId) => {
  const kite = getKiteInstance(accessToken);
  const orders = await kite.getOrders();

  const order = orders.find(o => o.order_id === orderId);
  return order?.status;
};

// =====================
// NEW: GET ORDER DETAILS (CRITICAL FOR EXECUTION ENGINE)
// =====================
exports.getOrderDetails = async (accessToken, orderId) => {
  const kite = getKiteInstance(accessToken);
  const orders = await kite.getOrders();

  const order = orders.find(o => o.order_id === orderId);

  if (!order) {
    throw new Error("Order not found");
  }

  return {
    status: order.status,
    filled_quantity: order.filled_quantity,
    quantity: order.quantity,
    average_price: order.average_price
  };
};

// =====================
// NEW: CANCEL ORDER (CRITICAL FOR RETRY ENGINE)
// =====================
exports.cancelOrder = async (accessToken, orderId) => {
  try {
    const kite = getKiteInstance(accessToken);

    return await kite.cancelOrder("regular", orderId);
  } catch (err) {
    logger.error("CANCEL ERROR:", err.message);
    throw err;
  }
};

exports.getProfile = async (accessToken) => {
  const kiteInstance = getKiteInstance(accessToken);
  return await kiteInstance.getProfile();
};