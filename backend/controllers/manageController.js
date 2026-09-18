const Category = require('../models/category');
const Order = require('../models/order');
const Product = require('../models/product');
const Store = require('../models/store');
const User = require('../models/user');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { assertCanManageStore } = require('../utils/permissions');
const { shipmentView } = require('../services/orders');

// Endpoints for the admin and vendor portals. Unlike the public ones, these include
// hidden (isActive: false) stores and products so they can be edited and re-enabled.

const LOW_STOCK = 5;

const MANAGED_PRODUCT_FIELDS =
  'name images category minPrice minPriceCompareAt variants isActive ratingAvg ratingCount soldCount createdAt updatedAt';

const ORDER_STATUSES = Order.SHIPMENT_STATUSES;

function activeFilter(status) {
  if (status === 'active') return { isActive: true };
  if (status === 'inactive') return { isActive: false };
  return {};
}

async function loadManagedStore(req) {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  assertCanManageStore(req.user, store);
  return store;
}

const zeroByStatus = () => Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));

// ---------------------------------------------------------------- vendor + admin

// GET /me/stores   (stores owned by the current user, including hidden ones)
exports.listMyStores = async (req, res) => {
  const stores = await Store.find({ owner: req.user._id }).sort({ createdAt: 1 });
  res.json({ success: true, stores });
};

// GET /manage/stores/:id
exports.getManagedStore = async (req, res) => {
  const store = await loadManagedStore(req);
  await store.populate('owner', 'firstName lastName phone');
  res.json({ success: true, store });
};

// GET /manage/stores/:id/products?q=&status=
exports.listManagedProducts = async (req, res) => {
  const store = await loadManagedStore(req);
  const { q, status, cursor, limit } = req.validated.query;

  const filter = { store: store._id, ...activeFilter(status) };
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  const page = await findPage(Product, filter, {
    cursor,
    limit,
    project: (query) => query.select(MANAGED_PRODUCT_FIELDS).slice('images', 1).populate('category', 'name'),
  });
  res.json({ success: true, ...page });
};

// GET /manage/products/:id   (full product for the edit form)
exports.getManagedProduct = async (req, res) => {
  const product = await Product.findById(req.params.id).populate('category', 'name');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const store = await Store.findById(product.store);
  if (!store) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  assertCanManageStore(req.user, store);
  res.json({ success: true, product });
};

// GET /manage/stores/:id/orders/:orderId   (the store's part of one order)
exports.getStoreOrder = async (req, res) => {
  const store = await loadManagedStore(req);
  const order = await Order.findOne({ _id: req.params.orderId, 'shipments.store': store._id });
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found');
  res.json({ success: true, order: shipmentView(order, order.shipments.find((s) => s.store.equals(store._id))) });
};

// GET /manage/stores/:id/stats   (vendor dashboard overview)
exports.getStoreStats = async (req, res) => {
  const store = await loadManagedStore(req);

  const [byStatus, productCount, activeProductCount, lowStockProducts, recent] = await Promise.all([
    Order.aggregate([
      { $match: { 'shipments.store': store._id } },
      { $unwind: '$shipments' },
      { $match: { 'shipments.store': store._id } },
      { $group: { _id: '$shipments.status', count: { $sum: 1 }, total: { $sum: '$shipments.total' } } },
    ]),
    Product.countDocuments({ store: store._id }),
    Product.countDocuments({ store: store._id, isActive: true }),
    Product.find({ store: store._id, 'variants.stock': { $lte: LOW_STOCK } })
      .select('name variants isActive')
      .sort({ _id: -1 })
      .limit(10),
    Order.find({ 'shipments.store': store._id }).sort({ _id: -1 }).limit(5),
  ]);

  const ordersByStatus = zeroByStatus();
  let deliveredRevenue = 0;
  for (const row of byStatus) {
    ordersByStatus[row._id] = row.count;
    if (row._id === 'delivered') deliveredRevenue = row.total;
  }

  res.json({
    success: true,
    stats: {
      ordersByStatus,
      // Sum of delivered shipments' totals (items after discounts + delivery), in piastres
      deliveredRevenue,
      products: { total: productCount, active: activeProductCount },
      lowStockThreshold: LOW_STOCK,
      lowStock: lowStockProducts.map((p) => ({
        _id: p._id,
        name: p.name,
        isActive: p.isActive,
        variants: p.variants.filter((v) => v.stock <= LOW_STOCK).map((v) => ({ _id: v._id, label: v.label, stock: v.stock })),
      })),
      recentOrders: recent.map((o) => shipmentView(o, o.shipments.find((s) => s.store.equals(store._id)))),
    },
  });
};

// GET /drivers   (for assigning a driver to a shipment)
exports.listDrivers = async (req, res) => {
  const drivers = await User.find({ role: 'driver' }).select('firstName lastName phone').sort({ firstName: 1, lastName: 1 }).limit(500);
  res.json({
    success: true,
    drivers: drivers.map((d) => ({ _id: d._id, firstName: d.firstName, lastName: d.lastName, phone: d.phone })),
  });
};

// ---------------------------------------------------------------- admin only

// GET /admin/stores?q=&status=   (all stores with their owner)
exports.listAdminStores = async (req, res) => {
  const { q, status, cursor, limit } = req.validated.query;
  const filter = activeFilter(status);
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

  const page = await findPage(Store, filter, {
    cursor,
    limit,
    project: (query) => query.populate('owner', 'firstName lastName phone'),
  });
  res.json({ success: true, ...page });
};

// GET /admin/categories   (including hidden ones)
exports.listAdminCategories = async (req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, categories });
};

// GET /admin/stats   (admin dashboard overview)
exports.getAdminStats = async (req, res) => {
  const [usersByRole, storeCount, activeStoreCount, productCount, activeProductCount, byStatus, recent] =
    await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      Store.countDocuments(),
      Store.countDocuments({ isActive: true }),
      Product.countDocuments(),
      Product.countDocuments({ isActive: true }),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$pricing.total' } } }]),
      Order.find().sort({ _id: -1 }).limit(5).select('number status pricing.total createdAt address.fullName'),
    ]);

  const users = { user: 0, vendor: 0, driver: 0, admin: 0 };
  for (const row of usersByRole) users[row._id] = row.count;

  const ordersByStatus = zeroByStatus();
  let deliveredRevenue = 0;
  for (const row of byStatus) {
    ordersByStatus[row._id] = row.count;
    if (row._id === 'delivered') deliveredRevenue = row.total;
  }

  res.json({
    success: true,
    stats: {
      users,
      stores: { total: storeCount, active: activeStoreCount },
      products: { total: productCount, active: activeProductCount },
      ordersByStatus,
      // Sum of delivered orders' totals, in piastres
      deliveredRevenue,
      recentOrders: recent,
    },
  });
};
