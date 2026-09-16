const mongoose = require('mongoose');
const { Schema } = mongoose;

const SHIPMENT_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

// Snapshot of what was bought, so later product edits never change past orders
const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    variantLabel: { type: String, required: true },
    image: { type: String, default: null },
    price: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    qty: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const statusEventSchema = new Schema(
  {
    status: { type: String, enum: SHIPMENT_STATUSES, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String },
  },
  { _id: false }
);

// Each store prepares and delivers its part of the order separately
const shipmentSchema = new Schema({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  storeName: { type: String, required: true },
  items: [orderItemSchema],
  itemsTotal: { type: Number, required: true },
  deliveryFee: { type: Number, required: true },
  couponDiscount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  status: { type: String, enum: SHIPMENT_STATUSES, default: 'pending' },
  statusHistory: [statusEventSchema],
  driver: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deliveredAt: { type: Date },
});

const orderSchema = new Schema(
  {
    // Human-friendly reference shown to customers, e.g. SM-7K3QX9PA
    number: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    address: {
      label: String,
      fullName: String,
      phone: String,
      line1: String,
      city: String,
      notes: String,
      location: { lat: Number, lng: Number },
    },
    shipments: [shipmentSchema],
    pricing: {
      itemCount: Number,
      subtotal: Number,
      itemSavings: Number,
      couponDiscount: Number,
      savings: Number,
      delivery: Number,
      total: Number,
      currency: { type: String, default: 'EGP' },
    },
    coupon: {
      type: new Schema({ code: String, type: { type: String }, value: Number }, { _id: false }),
      default: null,
    },
    // Payment methods are not decided yet; orders are recorded as unpaid.
    payment: {
      method: { type: String, default: null },
      status: { type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
    },
    // Overall status, derived from the shipments (see services/orders.js)
    status: { type: String, enum: SHIPMENT_STATUSES, default: 'pending' },
    notes: { type: String, default: '' },
  },
  { timestamps: true, optimisticConcurrency: true, toJSON: { versionKey: false } }
);

orderSchema.index({ user: 1, _id: -1 });
orderSchema.index({ 'shipments.store': 1, _id: -1 });
orderSchema.index({ 'shipments.driver': 1, _id: -1 });
orderSchema.index({ status: 1, _id: -1 });

const Order = mongoose.model('Order', orderSchema);
Order.SHIPMENT_STATUSES = SHIPMENT_STATUSES;

module.exports = Order;
