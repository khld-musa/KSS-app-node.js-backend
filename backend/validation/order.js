const { z } = require('zod');
const { objectId, money, text, requiredText, nonEmpty, page, phone, location } = require('./common');
const { MAX_QTY_PER_ITEM } = require('../services/cart');

const SHIPMENT_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

// ---------- addresses ----------

const addressShape = {
  label: text(30).optional(),
  fullName: requiredText(80),
  phone,
  line1: requiredText(200),
  city: requiredText(80),
  notes: text(300).optional(),
  location: location.optional(),
  isDefault: z.boolean().optional(),
};

exports.createAddress = z.object(addressShape);
exports.updateAddress = nonEmpty(z.object(addressShape).partial());
exports.addressParams = z.object({ addressId: objectId });

// ---------- cart ----------

const qty = z.number().int().min(1, 'Quantity must be at least 1').max(MAX_QTY_PER_ITEM, `At most ${MAX_QTY_PER_ITEM}`);

exports.addCartItem = z.object({ product: objectId, variant: objectId, qty: qty.default(1) });
exports.updateCartItem = nonEmpty(z.object({ variant: objectId.optional(), qty: qty.optional() }));
exports.cartItemParams = z.object({ itemId: objectId });
exports.applyCoupon = z.object({ code: z.string({ error: 'Enter a coupon code' }).trim().min(1, 'Enter a coupon code').max(30) });

// ---------- coupons (admin) ----------

const couponShape = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3–30 letters, digits, - or _'),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1),
  minSubtotal: money.optional(),
  maxDiscount: money.nullable().optional(),
  store: objectId.nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perUserLimit: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
};

exports.createCoupon = z.object(couponShape);
exports.updateCoupon = nonEmpty(z.object(couponShape).partial());
exports.listCoupons = z.object({ ...page });

// ---------- orders ----------

exports.createOrder = z.object({ addressId: objectId, notes: text(500).optional() });
exports.shipmentParams = z.object({ id: objectId, shipmentId: objectId });
exports.listOrders = z.object({ status: z.enum(SHIPMENT_STATUSES).optional(), ...page });

exports.updateShipment = z
  .object({
    status: z.enum(SHIPMENT_STATUSES).optional(),
    // assign (id) or unassign (null) a driver
    driver: objectId.nullable().optional(),
    note: text(300).optional(),
  })
  .refine((v) => v.status !== undefined || v.driver !== undefined, 'Nothing to update');
