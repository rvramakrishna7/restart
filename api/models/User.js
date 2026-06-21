const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["user", "owner"], default: "user" },
  isPaid: { type: Boolean, default: false },

  broker: {
    accessToken: String,
    connected: { type: Boolean, default: false }
  },

  strategy: {
    name: String,
    config: Object
  },
  slippage: {
    nifty: { type: Number, default: 1.5 },
    banknifty: { type: Number, default: 2.5 },
  },

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);