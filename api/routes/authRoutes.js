const express = require("express");
const router = express.Router();
const { signup, login } = require("../controllers/authController");
const auth = require("../middleware/auth");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

// ── PUBLIC SIGNUP DISABLED — invite-only platform ──
// router.post("/signup", signup);   // intentionally disabled
router.post("/login", login);

// =====================================================================
// OWNER — create a new user (invite-only). Owner logs in, then calls this.
// POST /api/auth/create-user   body: { name, email, password }
// =====================================================================
router.post("/create-user", auth, async (req, res) => {
  try {
    const me = await User.findById(req.user);
    if (!me || me.email !== process.env.OWNER_EMAIL) {
      return res.status(403).json({ success: false, msg: "Not authorized" });
    }

    const { name, email, password } = req.body || {};
    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, msg: "Valid email required" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, msg: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, msg: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });

    return res.json({
      success: true,
      msg: "User created",
      user: { _id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Create user error" });
  }
});

module.exports = router;