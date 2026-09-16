const Cart = require('../models/cart');
const Order = require('../models/order');
const Store = require('../models/store');
const User = require('../models/user');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');
const { canManageStore, assertCanManageStore } = require('../utils/permissions');
const { loadCart } = require('../services/cart');
const { reserveUse, releaseUse } = require('../services/coupons');
const orders = require('../services/orders');

const ORDER_CARD_FIELDS =
  'number status createdAt pricing shipments.storeName shipments.status shipments.items.name shipments.items.image shipments.items.qty';

const notFound = () => new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');

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

// POST /orders   (places an order from the current cart)
exports.createOrder = async (req, res) => {
  const user = req.user;
  const address = user.addresses.id(req.body.addressId);
  if (!address) throw new ApiError(422, 'ADDRESS_NOT_FOUND', 'Please choose a delivery address');

  const cart = await Cart.findOne({ user: user._id });
  if (!cart || !cart.items.length) throw new ApiError(422, 'CART_EMPTY', 'Your cart is empty');

  const { view, priced, coupon } = await loadCart(cart, user);
  if (view.issues.length) {
    throw new ApiError(409, 'CART_HAS_ISSUES', 'Some items in your cart need attention', view.issues);
  }
  if (view.coupon && !view.coupon.applied) {
    throw new ApiError(409, 'COUPON_NOT_APPLICABLE', view.coupon.error.message, view.coupon.error);
  }

  const lines = priced.stores.flatMap((g) => g.lines);
  const reserved = [];
  let couponReserved = false;
  let order;

  try {
    for (const line of lines) {
      const item = { product: line.product._id, variant: line.variant._id, qty: line.qty };
      if (!(await orders.reserveStock(item))) {
        throw new ApiError(
          409,
          'OUT_OF_STOCK',
          `${line.product.name} (${line.variant.label}) is no longer available in that quantity`,
          { itemId: line.itemId }
        );
      }
      reserved.push(item);
    }

    if (coupon) {
      if (!(await reserveUse(coupon))) {
        throw new ApiError(409, 'COUPON_USED_UP', 'This coupon has reached its usage limit');
      }
      couponReserved = true;
    }

    const now = new Date();
    order = await orders.createWithNumber({
      user: user._id,
      address: {
        label: address.label,
        fullName: address.fullName,
        phone: address.phone,
        line1: address.line1,
        city: address.city,
        notes: address.notes,
        location: address.location,
      },
      shipments: priced.stores.map((g) => ({
        store: g.store._id,
        storeName: g.store.name,
        items: g.lines.map((l) => ({
          product: l.product._id,
          variant: l.variant._id,
          name: l.product.name,
          variantLabel: l.variant.label,
          image: l.product.images[0]?.url ?? null,
          price: l.price,
          compareAtPrice: l.compareAtPrice,
          qty: l.qty,
          lineTotal: l.lineTotal,
        })),
        itemsTotal: g.itemsTotal,
        deliveryFee: g.deliveryFee,
        couponDiscount: g.couponDiscount,
        total: g.total,
        statusHistory: [{ status: 'pending', at: now, by: user._id }],
      })),
      pricing: priced.summary,
      coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
      notes: req.body.notes,
    });
  } catch (err) {
    // Undo whatever was reserved before the failure
    await orders.restock(reserved);
    if (couponReserved) await releaseUse(coupon.code);
    throw err;
  }

  await cart.deleteOne();
  res.status(201).json({ success: true, order });
};

// GET /orders   (the current user's orders)
exports.listMyOrders = async (req, res) => {
  const { status, cursor, limit } = req.validated.query;
  const filter = { user: req.user._id, ...(status && { status }) };
  const page = await findPage(Order, filter, { cursor, limit, project: (q) => q.select(ORDER_CARD_FIELDS) });
  res.json({ success: true, ...page });
};

// GET /orders/:id   (owner or admin)
exports.getOrder = async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw notFound();
  if (!order.user.equals(req.user._id) && req.user.role !== 'admin') throw notFound();
  res.json({ success: true, order });
};

// POST /orders/:id/cancel   (customer; only while nothing has been confirmed)
exports.cancelOrder = async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order || !order.user.equals(req.user._id)) throw notFound();

  const active = order.shipments.filter((s) => s.status !== 'cancelled');
  if (!active.length || active.some((s) => s.status !== 'pending')) {
    throw new ApiError(409, 'ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled');
  }

  const effects = active.flatMap((s) =>
    orders.applyTransition(order, s, 'cancelled', req.user._id, 'Cancelled by customer')
  );
  await order.save();
  await orders.runEffects(effects);

  res.json({ success: true, order });
};

// GET /stores/:id/orders   (store owner or admin; only this store's shipments)
exports.listStoreOrders = async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  assertCanManageStore(req.user, store);

  const { status, cursor, limit } = req.validated.query;
  const filter = { shipments: { $elemMatch: { store: store._id, ...(status && { status }) } } };
  const page = await findPage(Order, filter, { cursor, limit });

  res.json({
    success: true,
    items: page.items.map((o) => shipmentView(o, o.shipments.find((s) => s.store.equals(store._id)))),
    nextCursor: page.nextCursor,
  });
};

// GET /driver/shipments   (shipments assigned to the current driver)
exports.listDriverShipments = async (req, res) => {
  const { status, cursor, limit } = req.validated.query;
  const statuses = status ? [status] : ['confirmed', 'preparing', 'out_for_delivery'];
  const filter = { shipments: { $elemMatch: { driver: req.user._id, status: { $in: statuses } } } };
  const page = await findPage(Order, filter, { cursor, limit });

  res.json({
    success: true,
    items: page.items.flatMap((o) =>
      o.shipments
        .filter((s) => s.driver?.equals(req.user._id) && statuses.includes(s.status))
        .map((s) => shipmentView(o, s))
    ),
    nextCursor: page.nextCursor,
  });
};

// GET /admin/orders
exports.listAllOrders = async (req, res) => {
  const { status, cursor, limit } = req.validated.query;
  const page = await findPage(Order, status ? { status } : {}, { cursor, limit });
  res.json({ success: true, ...page });
};

async function actorFor(user, shipment) {
  if (user.role === 'admin') return 'admin';
  if (user.role === 'vendor') {
    const store = await Store.findById(shipment.store);
    if (store && canManageStore(user, store)) return 'store';
  }
  if (user.role === 'driver' && shipment.driver?.equals(user._id)) return 'driver';
  return null;
}

// PATCH /orders/:id/shipments/:shipmentId   { status?, driver?, note? }
exports.updateShipment = async (req, res) => {
  const { status: to, driver, note } = req.body;

  const order = await Order.findById(req.params.id);
  const shipment = order?.shipments.id(req.params.shipmentId);
  if (!shipment) throw new ApiError(404, 'SHIPMENT_NOT_FOUND', 'Order not found');

  const actor = await actorFor(req.user, shipment);
  if (!actor) throw new ApiError(403, 'FORBIDDEN', 'You cannot update this order');

  if (driver !== undefined) {
    if (actor === 'driver') {
      throw new ApiError(403, 'FORBIDDEN_FIELD', 'Only the store or an admin can assign a driver');
    }
    if (driver === null) {
      shipment.driver = null;
    } else {
      const driverUser = await User.findById(driver);
      if (!driverUser || driverUser.role !== 'driver') {
        throw new ApiError(422, 'INVALID_DRIVER', 'Driver not found');
      }
      shipment.driver = driverUser._id;
    }
  }

  let effects = [];
  if (to !== undefined) {
    if (!orders.canTransition(actor, shipment.status, to)) {
      if (orders.canTransition('admin', shipment.status, to)) {
        throw new ApiError(403, 'FORBIDDEN_TRANSITION', `You cannot mark this order as ${to}`);
      }
      throw new ApiError(422, 'INVALID_TRANSITION', `Cannot change status from ${shipment.status} to ${to}`);
    }
    if (to === 'out_for_delivery' && !shipment.driver) {
      throw new ApiError(422, 'DRIVER_REQUIRED', 'Assign a driver before sending the order out');
    }
    effects = orders.applyTransition(order, shipment, to, req.user._id, note);
  }

  await order.save();
  await orders.runEffects(effects);

  res.json({ success: true, order: actor === 'admin' ? order : shipmentView(order, shipment) });
};
