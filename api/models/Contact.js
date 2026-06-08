const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    phone: String,
    message: String,

    // CRM tracking
    replied: { type: Boolean, default: false },
    repliedAt: Date,
    notes: String, // owner's private notes about this lead
  },
  { timestamps: true },
);

module.exports = mongoose.model("Contact", contactSchema);