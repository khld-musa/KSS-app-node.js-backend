const crypto = require('crypto');
const Order = require('../models/order');
const Product = require('../models/product');
const { releaseUse } = require('./coupons');

// Shipment lifecycle:
//   pending -> confirmed -> preparing -> out_for_delivery -> delivered
//   (cancelled is possible until the shipment leaves the store; admins can also cancel on the way)
const TRANSITIONS = {
  store: {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
  },
  driver: {
    out_for_delivery: ['delivered'],
  },
  admin: {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'cancelled'],
  },
};

const PROGRESS = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const canTransition = (actor, from, to) => TRANSITIONS[actor][from]?.includes(to) ?? false;

// The order is as far along as its least-advanced shipment that is not cancelled.
function overallStatus(shipments) {
  const active = shipments.filter((s) => s.status !== 'cancelled');
  if (!active.length) return 'cancelled';
  return PROGRESS[Math.min(...active.map((s) => PROGRESS.indexOf(s.status)))];
}

// Unambiguous characters only (no 0/O, 1/I)
const NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateOrderNumber() {
  let out = 'SM-';
  for (let i = 0; i < 8; i++) out += NUMBER_ALPHABET[crypto.randomInt(NUMBER_ALPHABET.length)];
  return out;
}

async function createWithNumber(data) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await Order.create({ ...data, number: generateOrderNumber() });
    } catch (err) {
      if (!(err.code === 11000 && err.keyPattern?.number)) throw err;
    }
  }
  throw new Error('Could not generate a unique order number');
}

// Takes `qty` from a variant's stock only if enough is left. Returns false otherwise.
async function reserveStock({ product, variant, qty }) {
  const res = await Product.updateOne(
    { _id: product, isActive: true, variants: { $elemMatch: { _id: variant, stock: { $gte: qty } } } },
    { $inc: { 'variants.$.stock': -qty } }
  );
  return res.modifiedCount === 1;
}

// items: [{ product, variant, qty }] (ids)
async function restock(items) {
  for (const item of items) {
    await Product.updateOne(
      { _id: item.product, 'variants._id': item.variant },
      { $inc: { 'variants.$.stock': item.qty } }
    );
  }
}

async function addSoldCounts(items) {
  for (const item of items) {
    await Product.updateOne({ _id: item.product }, { $inc: { soldCount: item.qty } });
  }
}

// Moves a shipment to `to` in memory and updates the order's overall status.
// Returns side effects to run after the order has been saved successfully.
function applyTransition(order, shipment, to, userId, note) {
  const at = new Date();
  shipment.status = to;
  shipment.statusHistory.push({ status: to, at, by: userId, ...(note && { note }) });

  const effects = [];
  if (to === 'delivered') {
    shipment.deliveredAt = at;
    effects.push(() => addSoldCounts(shipment.items));
  }
  if (to === 'cancelled') {
    effects.push(() => restock(shipment.items));
  }

  const before = order.status;
  order.status = overallStatus(order.shipments);
  if (before !== 'cancelled' && order.status === 'cancelled' && order.coupon) {
    const { code } = order.coupon;
    effects.push(() => releaseUse(code));
  }
  return effects;
}

async function runEffects(effects) {
  for (const effect of effects) await effect();
}

// What a store or driver sees: the order header plus only their own shipment
const shipmentView = (order, shipment) => ({
  _id: order._id,
  number: order.number,
  status: order.status,
  createdAt: order.createdAt,
  address: order.address,
  notes: order.notes,
  shipment,
});

module.exports = {
  canTransition,
  shipmentView,
  overallStatus,
  createWithNumber,
  reserveStock,
  restock,
  applyTransition,
  runEffects,
};
