const express = require("express");
const router = express.Router();
const { sendAlert } = require("../../services/notify");

// =====================
// PUBLIC — submit contact form  →  Telegram alert (no DB, no auth)
// POST /api/contact
// body: { name, email, phone, message }
// =====================
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};

    // basic validation
    if (!name || !email || !phone || !message) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    // simple length guards (avoid abuse / huge payloads)
    if (
      String(name).length > 120 ||
      String(email).length > 160 ||
      String(phone).length > 30 ||
      String(message).length > 2000
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Input too long." });
    }

    // fire Telegram alert with the person's details (uses existing notify.js)
    const text =
      `📩 NEW CONTACT ENQUIRY\n` +
      `————————————\n` +
      `👤 Name: ${name}\n` +
      `📧 Email: ${email}\n` +
      `📞 Phone: ${phone}\n` +
      `💬 Message: ${message}\n` +
      `🕒 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

    await sendAlert(text); // silent no-op if Telegram env vars unset; never throws

    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong. Please try again." });
  }
});

module.exports = router;