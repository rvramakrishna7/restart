const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Contact = require("../models/Contact");
const Position = require("../models/Position");
const Trade = require("../models/Trade");
const auth = require("../middleware/auth");

// ── owner guard ──
async function ownerOnly(req, res, next) {
  try {
    const me = await User.findById(req.user);
    if (!me || me.email !== process.env.OWNER_EMAIL) {
      return res.status(403).json({ success: false, msg: "Not authorized" });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, msg: "Auth error" });
  }
}

// =====================================================================
// OWNER — dashboard summary stats
// =====================================================================
router.get("/stats", auth, ownerOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({ isPaid: true });
    const totalContacts = await Contact.countDocuments();
    const unrepliedContacts = await Contact.countDocuments({ replied: false });
    const openPositions = await Position.countDocuments({ isClosed: false });
    const closedTrades = await Trade.countDocuments({ status: "CLOSED" });

    res.json({
      success: true,
      data: {
        totalUsers,
        paidUsers,
        totalContacts,
        unrepliedContacts,
        openPositions,
        closedTrades,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Stats error" });
  }
});

// =====================================================================
// OWNER — list registered users (no passwords) + open position count
// =====================================================================
router.get("/users", auth, ownerOnly, async (req, res) => {
  try {
    const users = await User.find().select("name email isPaid role createdAt broker.connected").sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Users error" });
  }
});

// =====================================================================
// OWNER — live open positions across ALL users with current pnl
// =====================================================================
router.get("/positions", auth, ownerOnly, async (req, res) => {
  try {
    const positions = await Position.find({ isClosed: false })
      .select("userId index strategyType pnl mode buyStrike sellStrike st_legs isStrangle createdAt")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: positions });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Positions error" });
  }
});

// =====================================================================
// OWNER — mark a user paid / unpaid
// =====================================================================
router.patch("/users/:id/paid", auth, ownerOnly, async (req, res) => {
  try {
    const { isPaid } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isPaid: !!isPaid },
      { new: true },
    ).select("name email isPaid");
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Update error" });
  }
});

module.exports = router;