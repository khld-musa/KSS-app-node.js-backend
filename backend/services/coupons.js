const Coupon = require('../models/coupon');
const Order = require('../models/order');

const fail = (code, message) => ({ coupon: null, error: { code, message } });

// Checks everything about a coupon that does not depend on the cart contents
// (minimum subtotal and store eligibility are checked by services/pricing.js).
async function findUsableCoupon(rawCode, userId) {
  const code = String(rawCode).trim().toUpperCase();
  const coupon = await Coupon.findOne({ code });
  const now = new Date();

  if (!coupon || !coupon.isActive || (coupon.startsAt && coupon.startsAt > now)) {
    return fail('COUPON_INVALID', 'This coupon code is not valid');
  }
  if (coupon.expiresAt && coupon.expiresAt <= now) {
    return fail('COUPON_EXPIRED', 'This coupon has expired');
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return fail('COUPON_USED_UP', 'This coupon has reached its usage limit');
  }
  if (coupon.perUserLimit != null) {
    const used = await Order.countDocuments({
      user: userId,
      'coupon.code': coupon.code,
      status: { $ne: 'cancelled' },
    });
    if (used >= coupon.perUserLimit) {
      return fail('COUPON_ALREADY_USED', 'You have already used this coupon');
    }
  }
  return { coupon, error: null };
}

// Takes one use atomically. Returns false if the limit was reached meanwhile.
async function reserveUse(coupon) {
  const res = await Coupon.updateOne(
    { _id: coupon._id, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
    { $inc: { usedCount: 1 } }
  );
  return res.modifiedCount === 1;
}

async function releaseUse(code) {
  await Coupon.updateOne({ code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

module.exports = { findUsableCoupon, reserveUse, releaseUse };
