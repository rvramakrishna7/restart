const logger = require("../utils/logger");
require("dotenv").config();

function required(key) {
  const val = process.env[key];
  if (!val) {
    logger.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
  return val;
}

module.exports = {
  ZERODHA_API_KEY:    required("ZERODHA_API_KEY"),
  ZERODHA_API_SECRET: required("ZERODHA_API_SECRET"),
  MONGO_URI:          required("MONGO_URI"),
  JWT_SECRET:         required("JWT_SECRET"),
  PORT:               process.env.PORT || 5000,
  NODE_ENV:           process.env.NODE_ENV || "development",
  FRONTEND_URL:       process.env.FRONTEND_URL || "http://localhost:3000",
  OWNER_EMAIL:        process.env.OWNER_EMAIL || "test@gmail.com",
};