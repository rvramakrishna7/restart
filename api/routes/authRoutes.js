const express = require("express");
const router = express.Router();
const { signup, login } = require("../controllers/authController");

// router.post("/signup", signup); disabled — invite-only
router.post("/login", login);

const auth = require("../middleware/auth");

router.post("/create-user", auth, async (req, res) => {
  const OWNER_EMAIL = process.env.OWNER_EMAIL; // set this in Render env
  const User = require("../models/User");
  const bcrypt = require("bcryptjs");
  try {
    // only the owner (identified by their logged-in account) can create users
    const me = await User.findById(req.user);
    if (!me || me.email !== OWNER_EMAIL) {
      return res.status(403).json({ msg: "Not authorized" });
    }
    const { name, email, password } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ msg: "Invalid email" });
    if (!password || password.length < 6) return res.status(400).json({ msg: "Password min 6 chars" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: "User already exists" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    res.json({ msg: "User created", user: { _id: user._id, email: user.email } });
  } catch (err) {
    res.status(500).json({ msg: "Create user error" });
  }
});

module.exports = router;