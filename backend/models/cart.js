const mongoose = require('mongoose');
const { Schema } = mongoose;

// A cart only stores references. Prices, stock and totals are always read live
// from the products when the cart is viewed (see services/cart.js).
const cartItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variant: { type: Schema.Types.ObjectId, required: true },
  qty: { type: Number, required: true, min: 1 },
});

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: [cartItemSchema],
    couponCode: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
