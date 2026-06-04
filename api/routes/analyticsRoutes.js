const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const {
  getSummary,
  getDailyPnL,
  getStrategyPerformance,
  getTradeHistory,
} = require("../controllers/analyticsController");

// All analytics endpoints are scoped to the authenticated user.
router.get("/summary", auth, getSummary);
router.get("/daily", auth, getDailyPnL);
router.get("/strategy", auth, getStrategyPerformance);
router.get("/history", auth, getTradeHistory);

module.exports = router;
