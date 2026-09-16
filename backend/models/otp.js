const mongoose = require('mongoose');
const { Schema } = mongoose;

// One live code per (phone, purpose). MongoDB drops the document once expiresAt passes.
const otpSchema = new Schema(
  {
    phone: { type: String, required: true },
    purpose: { type: String, enum: ['signup', 'reset'], required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
  },
  { timestamps: true }
);

otpSchema.index({ phone: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
