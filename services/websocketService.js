const logger = require("../utils/logger");
const KiteTicker = require("kiteconnect").KiteTicker;
const { broadcast } = require("./socketServer");
const { ZERODHA_API_KEY } = require("../config/env");

const apiKey = ZERODHA_API_KEY;

let ticker = null;
let currentTokens = [];
let listeners = [];

// ── called once at startup ──
function registerListener(fn) {
  listeners.push(fn);
}

// ── called after execute to wire adjustment engine ──
function initWebSocket(accessToken, tokens, onTick) {
  if (ticker) {
    logger.log("⚠️ WebSocket already running");
    // still update subscription with new tokens
    if (tokens && tokens.length) updateSubscription(tokens);
    return true;
  }

  if (!accessToken) {
    logger.log("❌ No valid Zerodha session found → WS not started");
    return false;
  }

  ticker = new KiteTicker({
    api_key: apiKey,
    access_token: accessToken,
  });

  ticker.connect();

  ticker.on("connect", () => {
    logger.log("📡 WebSocket Connected");
    global._positionErrorLogged = false;
    global._marketErrorLogged   = false;

    const INDEX_TOKENS = [256265, 260105];
    // ALWAYS subscribe on connect — this is the only moment the socket is
    // guaranteed open. Runs on first connect AND every reconnect, so the
    // index tokens can never be silently dropped.
    const finalTokens = [...new Set([...(currentTokens || []), ...(tokens || []), ...INDEX_TOKENS])];

    if (finalTokens.length > 0 && ticker) {
      logger.log("📡 WS Tokens (on connect):", finalTokens);
      ticker.subscribe(finalTokens);
      ticker.setMode(ticker.modeLTP, finalTokens);
      currentTokens = finalTokens;
    }

    global.wsStarted = true;
  });

  ticker.on("ticks", (ticks) => {
    if (!ticks || !ticks.length) return;
    const spotTick = ticks.find(t => t.instrument_token === 256265 || t.instrument_token === 260105);
    // ── TEMP PROBE: is the index actually streaming? ──
    if (!global._tickProbeAt || Date.now() - global._tickProbeAt > 5000) {
      global._tickProbeAt = Date.now();
      logger.log(
        "🔎 TICK PROBE | tokens in batch:", ticks.map(t => t.instrument_token),
        "| 256265 price:", spotTick ? spotTick.last_price : "NOT PRESENT"
      );
    }

    // 1. original engine callback
    onTick(ticks);

    // 2. update live ltp map in strategyController
    try {
      const { updateTickMap } = require("./strategyControllerBridge");
      updateTickMap(ticks);
    } catch (err) {
      // path resolved via bridge file — see note below
    }

    // 3. run all registered listeners (adjustment engine etc.)
    listeners.forEach((fn) => {
      try { fn(ticks); } catch (err) {
        logger.log("⚠️ Listener error:", err.message);
      }
    });

    // 4. push ticks to all connected browser clients
    broadcast(ticks);
  });

  ticker.on("disconnect", () => {
    logger.log("❌ WebSocket Disconnected — will reconnect automatically");
    ticker = null;
    global.wsStarted = false;
  });

  ticker.on("error", (err) => {
    if (err?.message?.includes("400")) return;
    logger.log("⚠️ WS Error:", err.message);
  });

  return true;
}

function updateSubscription(newTokens) {
  logger.log("UPDATE SUB CALLED:", newTokens);

  if (!ticker) {
    logger.log("⚠️ updateSubscription called but ticker is null — skipping");
    return;
  }

  const INDEX_TOKENS = [256265, 260105];

  const toUnsubscribe = currentTokens.filter(
    (t) => !newTokens.includes(t) && !INDEX_TOKENS.includes(t), // never unsubscribe the index
  );
  let toSubscribe = newTokens.filter((t) => !currentTokens.includes(t));

  // ── ALWAYS (re)subscribe the index tokens — idempotent, guarantees spot streams ──
  for (const idx of INDEX_TOKENS) {
    if (!toSubscribe.includes(idx)) toSubscribe.push(idx);
  }

  if (toUnsubscribe.length) {
    ticker.unsubscribe(toUnsubscribe);
  }

  if (toSubscribe.length > 0) {
    ticker.subscribe(toSubscribe);
    ticker.setMode(ticker.modeLTP, toSubscribe);
    logger.log("📡 Subscribed Tokens:", toSubscribe);
  }

  // keep index tokens in the bookkeeping set always
  currentTokens = [...new Set([...newTokens, ...INDEX_TOKENS])];
  logger.log("📡 Updated Tokens:", currentTokens);
}
function disconnectWebSocket() {
  if (ticker) {
    try { ticker.disconnect(); } catch (_) {}
    ticker = null;
  }
  // ── do NOT clear currentTokens on manual disconnect ──
  // needed so next initWebSocket call can resubscribe all tokens
  global.wsStarted = false;
  logger.log("🔌 WebSocket forcefully disconnected");
}

module.exports = {
  initWebSocket,
  updateSubscription,
  registerListener,
  disconnectWebSocket,
};