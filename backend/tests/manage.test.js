const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const Category = require('../models/category');
const Store = require('../models/store');
const Product = require('../models/product');
const Order = require('../models/order');

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

async function seed() {
  const admin = await createUser({ role: 'admin' });
  const vendor = await createUser({ role: 'vendor' });
  const otherVendor = await createUser({ role: 'vendor' });
  const customer = await createUser();
  const driver = await createUser({ role: 'driver', firstName: 'Omar', lastName: 'Driver' });

  const skincare = await Category.create({ name: 'Skincare' });
  await Category.create({ name: 'Hidden', isActive: false });

  const camli = await Store.create({ name: 'Camli Beauty', owner: vendor.user._id });
  const hiddenStore = await Store.create({ name: 'Camli Outlet', owner: vendor.user._id, isActive: false });
  const other = await Store.create({ name: 'Good Food', owner: otherVendor.user._id });

  const product = (name, extra = {}) =>
    Product.create({
      store: camli._id,
      category: skincare._id,
      name,
      variants: [{ label: '100 ml', price: 30000, stock: 10 }],
      ...extra,
    });

  const dilka = await product('Nayra Sandalwood Dilka', {
    variants: [
      { label: '100 ml', price: 30000, stock: 2 },
      { label: '250 ml', price: 54000, stock: 20 },
    ],
  });
  const draft = await product('Draft Product', { isActive: false });
  const foodItem = await Product.create({
    store: other._id,
    category: skincare._id,
    name: 'Kisra',
    variants: [{ label: 'Pack', price: 5000, stock: 10 }],
  });

  return { admin, vendor, otherVendor, customer, driver, camli, hiddenStore, other, dilka, draft, foodItem };
}

// Two-store order: Camli's part (dilka) and Good Food's part (kisra)
function orderFor(s, { camliStatus = 'pending', camliTotal = 33000 } = {}) {
  const shipment = (store, product, status, total) => ({
    store: store._id,
    storeName: store.name,
    items: [{ product: product._id, variant: product.variants[0]._id, name: product.name, variantLabel: 'x', price: 1, qty: 1, lineTotal: 1 }],
    itemsTotal: total,
    deliveryFee: 0,
    total,
    status,
  });
  return Order.create({
    number: `SM-T${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    user: s.customer.user._id,
    status: camliStatus === 'delivered' ? 'pending' : camliStatus,
    address: { fullName: 'Mona Ali', phone: '+201234567890', line1: 'Talaat Harb', city: 'Cairo' },
    shipments: [shipment(s.camli, s.dilka, camliStatus, camliTotal), shipment(s.other, s.foodItem, 'pending', 9999)],
    pricing: { total: camliTotal + 9999 },
  });
}

describe('vendor portal endpoints', () => {
  test('a vendor sees only their own stores, including hidden ones', async () => {
    const s = await seed();
    const res = await api().get('/api/v1/me/stores').set(s.vendor.auth).expect(200);
    assert.deepEqual(res.body.stores.map((st) => st.name), ['Camli Beauty', 'Camli Outlet']);

    const detail = await api().get(`/api/v1/manage/stores/${s.hiddenStore._id}`).set(s.vendor.auth).expect(200);
    assert.equal(detail.body.store.isActive, false);
    assert.equal(detail.body.store.owner.firstName, 'Test');

    await api().get(`/api/v1/manage/stores/${s.camli._id}`).set(s.otherVendor.auth).expect(403);
    await api().get('/api/v1/me/stores').set(s.customer.auth).expect(403);
  });

  test('the product list includes hidden products and can be filtered', async () => {
    const s = await seed();
    const url = `/api/v1/manage/stores/${s.camli._id}/products`;

    let res = await api().get(url).set(s.vendor.auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Draft Product', 'Nayra Sandalwood Dilka']);
    assert.equal(res.body.items[1].variants.length, 2);
    assert.equal(res.body.items[1].category.name, 'Skincare');

    res = await api().get(`${url}?status=inactive`).set(s.vendor.auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Draft Product']);
    res = await api().get(`${url}?status=active&q=dilka`).set(s.vendor.auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Nayra Sandalwood Dilka']);

    await api().get(url).set(s.otherVendor.auth).expect(403);
    await api().get(url).set(s.admin.auth).expect(200);
  });

  test('a hidden product can be opened for editing, but not by another vendor', async () => {
    const s = await seed();
    const res = await api().get(`/api/v1/manage/products/${s.draft._id}`).set(s.vendor.auth).expect(200);
    assert.equal(res.body.product.isActive, false);
    await api().get(`/api/v1/manage/products/${s.draft._id}`).set(s.otherVendor.auth).expect(403);
    await api().get('/api/v1/manage/products/0123456789abcdef01234567').set(s.vendor.auth).expect(404);
  });

  test('store stats: orders by status, delivered revenue, products, low stock, recent orders', async () => {
    const s = await seed();
    await orderFor(s, { camliStatus: 'pending' });
    await orderFor(s, { camliStatus: 'delivered', camliTotal: 50000 });
    await orderFor(s, { camliStatus: 'delivered', camliTotal: 20000 });

    const { stats } = (await api().get(`/api/v1/manage/stores/${s.camli._id}/stats`).set(s.vendor.auth).expect(200)).body;
    assert.equal(stats.ordersByStatus.pending, 1);
    assert.equal(stats.ordersByStatus.delivered, 2);
    assert.equal(stats.ordersByStatus.cancelled, 0);
    assert.equal(stats.deliveredRevenue, 70000); // only Camli's shipments, never Good Food's
    assert.deepEqual(stats.products, { total: 2, active: 1 });
    assert.deepEqual(stats.lowStock.map((p) => [p.name, p.variants.map((v) => v.label)]), [['Nayra Sandalwood Dilka', ['100 ml']]]);
    assert.equal(stats.recentOrders.length, 3);
    assert.equal(stats.recentOrders[0].shipment.storeName, 'Camli Beauty');

    await api().get(`/api/v1/manage/stores/${s.camli._id}/stats`).set(s.otherVendor.auth).expect(403);
  });

  test('a single order shows only the store’s own part', async () => {
    const s = await seed();
    const order = await orderFor(s);

    const res = await api().get(`/api/v1/manage/stores/${s.camli._id}/orders/${order._id}`).set(s.vendor.auth).expect(200);
    assert.equal(res.body.order.number, order.number);
    assert.equal(res.body.order.shipment.storeName, 'Camli Beauty');
    assert.equal(res.body.order.shipments, undefined);
    assert.equal(res.body.order.address.fullName, 'Mona Ali');

    // an order with no part from this store is not visible through it
    const onlyFood = await Order.create({
      number: 'SM-ONLYFOOD',
      user: s.customer.user._id,
      shipments: [{ store: s.other._id, storeName: 'Good Food', items: [], itemsTotal: 0, deliveryFee: 0, total: 0 }],
    });
    await api().get(`/api/v1/manage/stores/${s.camli._id}/orders/${onlyFood._id}`).set(s.vendor.auth).expect(404);
    await api().get(`/api/v1/manage/stores/${s.camli._id}/orders/${order._id}`).set(s.otherVendor.auth).expect(403);
  });

  test('vendors and admins can list drivers; customers cannot', async () => {
    const s = await seed();
    const res = await api().get('/api/v1/drivers').set(s.vendor.auth).expect(200);
    assert.deepEqual(res.body.drivers.map((d) => [d.firstName, d.phone]), [['Omar', s.driver.user.phone]]);
    assert.equal(res.body.drivers[0].role, undefined);
    await api().get('/api/v1/drivers').set(s.customer.auth).expect(403);
  });
});

describe('store edits from the portal', () => {
  test('location and delivery time can be removed with null', async () => {
    const s = await seed();
    const url = `/api/v1/stores/${s.camli._id}`;
    let res = await api()
      .patch(url)
      .set(s.vendor.auth)
      .send({ location: { lat: 30.05, lng: 31.24 }, deliveryMinutes: { min: 30, max: 40 } })
      .expect(200);
    assert.deepEqual(res.body.store.location, { lat: 30.05, lng: 31.24 });
    assert.deepEqual(res.body.store.deliveryMinutes, { min: 30, max: 40 });

    res = await api().patch(url).set(s.vendor.auth).send({ location: null, deliveryMinutes: null }).expect(200);
    assert.equal(res.body.store.location, undefined);
    assert.equal(res.body.store.deliveryMinutes?.min, undefined);

    const stored = await Store.findById(s.camli._id);
    assert.equal(stored.location, undefined);
    assert.equal(stored.deliveryMinutes?.min, undefined);

    // the cleared store no longer shows up in nearby searches
    const near = await api().get('/api/v1/stores?lat=30.05&lng=31.24').expect(200);
    assert.ok(!near.body.items.some((st) => st.name === 'Camli Beauty'));
  });
});

describe('admin portal endpoints', () => {
  test('all stores with owners, filterable', async () => {
    const s = await seed();
    let res = await api().get('/api/v1/admin/stores').set(s.admin.auth).expect(200);
    assert.equal(res.body.items.length, 3);
    assert.ok(res.body.items.every((st) => st.owner.firstName));

    res = await api().get('/api/v1/admin/stores?status=inactive').set(s.admin.auth).expect(200);
    assert.deepEqual(res.body.items.map((st) => st.name), ['Camli Outlet']);
    res = await api().get('/api/v1/admin/stores?q=good').set(s.admin.auth).expect(200);
    assert.deepEqual(res.body.items.map((st) => st.name), ['Good Food']);

    await api().get('/api/v1/admin/stores').set(s.vendor.auth).expect(403);
  });

  test('all categories, including hidden ones', async () => {
    const s = await seed();
    const res = await api().get('/api/v1/admin/categories').set(s.admin.auth).expect(200);
    assert.deepEqual(res.body.categories.map((c) => c.name), ['Hidden', 'Skincare']);
    await api().get('/api/v1/admin/categories').set(s.vendor.auth).expect(403);
  });

  test('platform stats', async () => {
    const s = await seed();
    await orderFor(s);
    const delivered = await orderFor(s);
    await Order.updateOne({ _id: delivered._id }, { status: 'delivered', 'pricing.total': 12345 });

    const { stats } = (await api().get('/api/v1/admin/stats').set(s.admin.auth).expect(200)).body;
    assert.deepEqual(stats.users, { user: 1, vendor: 2, driver: 1, admin: 1 });
    assert.deepEqual(stats.stores, { total: 3, active: 2 });
    assert.deepEqual(stats.products, { total: 3, active: 2 });
    assert.equal(stats.ordersByStatus.pending, 1);
    assert.equal(stats.ordersByStatus.delivered, 1);
    assert.equal(stats.deliveredRevenue, 12345);
    assert.equal(stats.recentOrders.length, 2);
    assert.equal(stats.recentOrders[0].address.fullName, 'Mona Ali');

    await api().get('/api/v1/admin/stats').set(s.vendor.auth).expect(403);
  });
});
