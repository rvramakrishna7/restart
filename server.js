require("dns").setDefaultResultOrder("ipv4first");
const { MONGO_URI, PORT } = require("./config/env");
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");

const strategyRoutes = require("./api/routes/strategyRoutes");
const userRoutes = require("./api/routes/userRoutes");
const analyticsRoutes = require("./api/routes/analyticsRoutes");
const authRoutes = require("./api/routes/authRoutes");
const contactRoutes = require("./api/routes/contactRoutes");
const adminRoutes = require("./api/routes/adminRoutes");
const { initWebSocket } = require("./services/websocketService");
const { initSocket } = require("./services/socketServer");

const zerodhaService = require("./services/zerodhaService");

const app = express();
const server = http.createServer(app);

// =====================
// MIDDLEWARE
// =====================
app.use(cors());
app.use(express.json());

// =====================
// HEALTH CHECK
// =====================
app.get("/", (req, res) => {
  res.send("Options Engine Running");
});

// =====================
// ROUTES
// =====================
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/strategy", strategyRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
initSocket(server);

// =====================
// DATABASE CONNECTION
// =====================
mongoose
  .connect(MONGO_URI, {})
  .then(() => console.log("✅ Mongo Connected"))
  .catch((err) => {
    console.error("❌ Mongo Error:", err);
    process.exit(1); // stop app if DB fails
  });

const positionManager = require("./managers/positionManagerInstance");

(async () => {
  await positionManager.loadPositionsFromDB();
})();

// =====================
// SERVER START
// =====================

server.listen(PORT, () => {
  console.log(`🚀 Trading Engine API running on port ${PORT}`);
});

async function startGlobalWS() {
  try {
    console.log("🌐 Starting Global WebSocket...");

    const User = require("./api/models/User");

    const users = await User.find({
      "broker.accessToken": {
        $exists: true,
        $ne: null,
      },
    });

    let validUser = null;

    for (let u of users) {
      try {
        await zerodhaService.getProfile(u.broker.accessToken);
        validUser = u;
        break;
      } catch (err) {
        console.log("⚠️ Skipping invalid token user:", u._id);
      }
    }

    if (!validUser) {
      console.log("❌ No valid Zerodha session found → WS not started");
      return;
    }

    const token = validUser.broker.accessToken;

    const INDEX_TOKENS = [256265, 260105];

    initWebSocket(
      token,
      INDEX_TOKENS,
      positionManager.handleTicks.bind(positionManager),
    );
  } catch (err) {
    console.log("❌ Global WS Error:", err.message);
  }
}
startGlobalWS();
