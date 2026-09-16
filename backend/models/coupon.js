const mongoose = require('mongoose');
const { Schema } = mongoose;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    // percent: 1..100; fixed: piastres
    value: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator(v) {
          return this.type !== 'percent' || v <= 100;
        },
        message: 'A percent coupon cannot be more than 100',
      },
    },
    // Piastres. Measured on the eligible items' total after sale prices.
    minSubtotal: { type: Number, min: 0, default: 0 },
    // Piastres. Caps a percent coupon. null = no cap.
    maxDiscount: { type: Number, min: 0, default: null },
    // Limits the coupon to one store's items. null = whole cart.
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    startsAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      default: null,
      validate: {
        validator(v) {
          return !v || !this.startsAt || v > this.startsAt;
        },
        message: 'expiresAt must be after startsAt',
      },
    },
    // Total uses across all customers. null = unlimited.
    usageLimit: { type: Number, min: 1, default: null },
    // Uses per customer. null = unlimited.
    perUserLimit: { type: Number, min: 1, default: null },
    usedCount: { type: Number, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

module.exports = mongoose.model('Coupon', couponSchema);
