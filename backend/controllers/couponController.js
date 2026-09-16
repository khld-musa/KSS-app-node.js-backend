const Coupon = require('../models/coupon');
const Store = require('../models/store');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');

async function loadCoupon(id) {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw new ApiError(404, 'COUPON_NOT_FOUND', 'Coupon not found');
  return coupon;
}

async function assertValidFields({ code, store }, exceptId) {
  if (code !== undefined) {
    const filter = { code };
    if (exceptId) filter._id = { $ne: exceptId };
    if (await Coupon.exists(filter)) throw new ApiError(409, 'COUPON_EXISTS', 'A coupon with this code already exists');
  }
  if (store && !(await Store.exists({ _id: store }))) {
    throw new ApiError(422, 'INVALID_STORE', 'Store not found');
  }
}

// GET /admin/coupons
exports.listCoupons = async (req, res) => {
  const { cursor, limit } = req.validated.query;
  const page = await findPage(Coupon, {}, { cursor, limit });
  res.json({ success: true, ...page });
};

// POST /admin/coupons
exports.createCoupon = async (req, res) => {
  await assertValidFields(req.body);
  const coupon = await Coupon.create(req.body);
  res.status(201).json({ success: true, coupon });
};

// PATCH /admin/coupons/:id
exports.updateCoupon = async (req, res) => {
  const coupon = await loadCoupon(req.params.id);
  await assertValidFields(req.body, coupon._id);
  coupon.set(req.body);
  await coupon.save();
  res.json({ success: true, coupon });
};

// DELETE /admin/coupons/:id   (past orders keep their own snapshot of the coupon)
exports.deleteCoupon = async (req, res) => {
  const coupon = await loadCoupon(req.params.id);
  await coupon.deleteOne();
  res.json({ success: true });
};
