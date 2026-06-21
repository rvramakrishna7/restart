const logger = require("../../utils/logger");
const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const User = require("../models/User");
const zerodhaService = require("../../services/zerodhaService");
const { FRONTEND_URL, OWNER_EMAIL } = require("../../config/env");

// =====================
// ZERODHA LOGIN
// =====================
router.get("/broker/zerodha/login", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send("User ID missing");
    }

    // Only the owner account may connect a live broker. Everyone else is
    // sent to the beta page. This is enforced here so it can't be bypassed
    // by hitting the URL directly.
    const user = await User.findById(userId);
    if (!user || user.email !== OWNER_EMAIL) {
      return res.redirect(`${FRONTEND_URL}/broker-access`);
    }

    global.ZERODHA_USER_ID = userId;

    const url = zerodhaService.getLoginUrl();

    return res.redirect(url);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Error generating Zerodha URL");
  }
});

// =====================
// ZERODHA CALLBACK
// =====================
router.get("/broker/zerodha/callback", async (req, res) => {
  try {
    const { request_token } = req.query;

    const userId = global.ZERODHA_USER_ID;

    if (!request_token) {
      return res.status(400).send("Request token missing");
    }

    if (!userId) {
      return res.status(400).send("User session expired. Try again.");
    }

    const data = await zerodhaService.generateSession(request_token);

    await User.findByIdAndUpdate(userId, {
      broker: {
        accessToken: data.access_token,
        connected: true,
      },
    });
    const { initWebSocket } = require("../../services/websocketService");
    const mgr = require("../../managers/positionManagerInstance");

    const INDEX_TOKENS = [256265, 260105];

    const { disconnectWebSocket } = require("../../services/websocketService");
    disconnectWebSocket();
    global.brokerDisconnected = false;
    global.wsStarted          = false;
    initWebSocket(data.access_token, INDEX_TOKENS, mgr.handleTicks.bind(mgr));
    // ── resubscribe all position tokens after broker reconnect ──
    setTimeout(() => {
      mgr.updateTokens();
    }, 3000);

    global.ZERODHA_USER_ID = null;

    return res.redirect(`${FRONTEND_URL}/dashboard?broker=connected`);
  } catch (err) {
    logger.error(err);
    res.status(500).send(err.message);
  }
});

// =====================
// MARKET DATA (FOR NAVBAR)
// =====================
router.get("/market-data", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user);

    if (!user?.broker?.accessToken) {
      return res.json({
        success: true,
        data: {
          nifty: 0,
          banknifty: 0,
        },
      });
    }

    const token = user.broker.accessToken;

    const nifty = await zerodhaService.getSpotPrice(token, "NIFTY");
    const banknifty = await zerodhaService.getSpotPrice(token, "BANKNIFTY");

    res.json({
      success: true,
      data: {
        nifty,
        banknifty,
      },
    });
  } catch (err) {
    logger.error("Market data error:", err.message);

    res.json({
      success: true,
      data: {
        nifty: 0,
        banknifty: 0,
      },
    });
  }
});

// =====================
// DISCONNECT BROKER
// =====================
router.post("/broker/disconnect", auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user, {
      "broker.connected": false,
      "broker.accessToken": null,
    });

    // ── stop WebSocket immediately ──
    const { disconnectWebSocket } = require("../../services/websocketService");
    disconnectWebSocket();

    // ── reset error flags so logs show again on next connect ──
    global._positionErrorLogged = false;
    global._marketErrorLogged   = false;
    global.wsStarted            = false;
    global.brokerDisconnected   = true;

    logger.log("🔌 Broker disconnected — WebSocket stopped");

    res.json({ success: true, message: "Broker disconnected" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// STATUS
// =====================
router.get("/status", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user);

    const isConnected = user?.broker?.connected === true;

    res.json({
      success: true,
      data: {
        brokerConnected: !!isConnected,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================
// SLIPPAGE SETTINGS
// =====================
router.get("/slippage", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user).select("slippage");
    res.json({
      success: true,
      data: {
        nifty: user?.slippage?.nifty ?? 1.5,
        banknifty: user?.slippage?.banknifty ?? 2.5,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/slippage", auth, async (req, res) => {
  try {
    const { nifty, banknifty } = req.body;
    await User.findByIdAndUpdate(req.user, {
      "slippage.nifty": Number(nifty),
      "slippage.banknifty": Number(banknifty),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// EXPORT
// =====================
module.exports = router;