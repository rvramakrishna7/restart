const express = require("express");
const router = express.Router();
const { sendAlert } = require("../../services/notify");
const Contact = require("../models/Contact");
const User = require("../models/User");
const auth = require("../middleware/auth");

// ── owner guard: reuses JWT auth, then checks email against OWNER_EMAIL ──
async function ownerOnly(req, res, next) {
  try {
    const me = await User.findById(req.user);
    if (!me || me.email !== process.env.OWNER_EMAIL) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Auth error" });
  }
}

// =====================
// PUBLIC — submit contact form  →  save to DB + Telegram alert (no auth)
// POST /api/contact
// body: { name, email, phone, message }
// =====================
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};

    if (!name || !email || !phone || !message) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

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

    // ── save the enquiry to DB (for the CRM) ──
    // wrapped so a DB hiccup never blocks the Telegram alert / user response
    let saved = null;
    try {
      saved = await Contact.create({ name, email, phone, message });
    } catch (dbErr) {
      // swallow — we still want the alert to fire and the user to get success
    }

    const text =
      `📩 NEW CONTACT ENQUIRY\n` +
      `————————————\n` +
      `👤 Name: ${name}\n` +
      `📧 Email: ${email}\n` +
      `📞 Phone: ${phone}\n` +
      `💬 Message: ${message}\n` +
      `🕒 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

    await sendAlert(text); // silent no-op if Telegram env vars unset; never throws

    return res.json({ success: true, id: saved?._id });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// =====================
// OWNER — list all enquiries (newest first)
// GET /api/contact
// =====================
router.get("/", auth, ownerOnly, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    return res.json({ success: true, data: contacts });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Fetch error" });
  }
});

// =====================
// OWNER — toggle replied / save notes for one enquiry
// PATCH /api/contact/:id
// body: { replied?: boolean, notes?: string }
// =====================
router.patch("/:id", auth, ownerOnly, async (req, res) => {
  try {
    const { replied, notes } = req.body || {};
    const update = {};
    if (typeof replied === "boolean") {
      update.replied = replied;
      update.repliedAt = replied ? new Date() : null;
    }
    if (typeof notes === "string") update.notes = notes;

    const contact = await Contact.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    return res.json({ success: true, data: contact });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Update error" });
  }
});

module.exports = router;