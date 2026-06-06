const logger = require("../utils/logger");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Sends a Telegram message. Silent no-op if not configured, never throws.
async function sendAlert(message) {
  try {
    if (!TOKEN || !CHAT_ID) return; // not configured → skip silently
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    logger.log("⚠️ Telegram alert failed:", err.message);
  }
}

module.exports = { sendAlert };