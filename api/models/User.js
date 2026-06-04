const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,

  broker: {
    accessToken: String,
    connected: { type: Boolean, default: false }
  },

  strategy: {
    name: String,
    config: Object
  }

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);