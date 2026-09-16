const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const Category = require('../models/category');
const Store = require('../models/store');
const Product = require('../models/product');
const Coupon = require('../models/coupon');
const ordersService = require('../services/orders');

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

// Two stores (Camli Beauty with the design's products, and a food store), their owners,
// a driver, an admin and a customer.
async function seed() {
  const admin = await createUser({ role: 'admin' });
  const vendorA = await createUser({ role: 'vendor' });
  const vendorB = await createUser({ role: 'vendor' });
  const driver = await createUser({ role: 'driver' });
  const customer = await createUser();

  const category = await Category.create({ name: 'Skincare' });
  const camli = await Store.create({
    name: 'Camli Beauty',
    owner: vendorA.user._id,
    deliveryFee: 3000,
    freeDeliveryThreshold: 112800,
  });
  const food = await Store.create({ name: 'Good Food', owner: vendorB.user._id, deliveryFee: 2000 });

  const dilka = await Product.create({
    store: camli._id,
    category: category._id,
    name: 'Nayra Sandalwood Dilka',
    variants: [
      { label: '100 ml', price: 30000, compareAtPrice: 35000, stock: 5 },
      { label: '250 ml', price: 54000, compareAtPrice: 62000, stock: 5 },
    ],
  });
  const butter = await Product.create({
    store: camli._id,
    category: category._id,
    name: 'Nayra Body Butter Refill Bag',
    variants: [{ label: 'Bag', price: 46000, compareAtPrice: 52000, stock: 3 }],
  });
  const kisra = await Product.create({
    store: food._id,
    category: category._id,
    name: 'Kisra',
    variants: [{ label: 'Pack', price: 5000, stock: 10 }],
  });

  return { admin, vendorA, vendorB, driver, customer, camli, food, dilka, butter, kisra };
}

const variantOf = (product, label) => String(product.variants.find((v) => v.label === label)._id);

async function stockOf(product, label) {
  const fresh = await Product.findById(product._id);
  return fresh.variants.find((v) => v.label === label).stock;
}

async function addToCart(user, product, label, qty = 1) {
  const res = await api()
    .post('/api/v1/cart/items')
    .set(user.auth)
    .send({ product: String(product._id), variant: variantOf(product, label), qty })
    .expect(201);
  return res.body.cart;
}

async function addAddress(user, overrides = {}) {
  const res = await api()
    .post('/api/v1/me/addresses')
    .set(user.auth)
    .send({
      fullName: 'Mona Ali',
      phone: '01234567890',
      line1: 'Talaat Harb Square, Downtown',
      city: 'Cairo',
      location: { lat: 30.0478, lng: 31.2386 },
      ...overrides,
    })
    .expect(201);
  return res.body.address;
}

async function createCoupon(admin, body) {
  const res = await api().post('/api/v1/admin/coupons').set(admin.auth).send(body).expect(201);
  return res.body.coupon;
}

async function placeOrder(user, address) {
  const res = await api().post('/api/v1/orders').set(user.auth).send({ addressId: address._id }).expect(201);
  return res.body.order;
}

describe('addresses', () => {
  test('the first address is the default; defaults move and survive deletion', async () => {
    const { customer } = await seed();

    const home = await addAddress(customer, { label: 'Home' });
    assert.equal(home.isDefault, true);
    assert.equal(home.phone, '+201234567890');

    const work = await addAddress(customer, { label: 'Work', isDefault: true });
    let list = (await api().get('/api/v1/me/addresses').set(customer.auth).expect(200)).body.addresses;
    assert.deepEqual(list.map((a) => [a.label, a.isDefault]), [['Home', false], ['Work', true]]);

    let res = await api().patch(`/api/v1/me/addresses/${work._id}`).set(customer.auth).send({ isDefault: false }).expect(422);
    assert.equal(res.body.error.code, 'DEFAULT_REQUIRED');

    res = await api().delete(`/api/v1/me/addresses/${work._id}`).set(customer.auth).expect(200);
    assert.deepEqual(res.body.addresses.map((a) => [a.label, a.isDefault]), [['Home', true]]);

    res = await api().post('/api/v1/me/addresses').set(customer.auth).send({ fullName: 'X', phone: '12', line1: 'a', city: 'b' }).expect(422);
    assert.equal(res.body.error.details[0].field, 'phone');
  });
});

describe('cart', () => {
  test('the design’s cart: prices, savings and the free-delivery hint', async () => {
    const { customer, dilka, butter } = await seed();
    await addToCart(customer, dilka, '250 ml');
    const cart = await addToCart(customer, butter, 'Bag');

    assert.deepEqual(cart.summary, {
      itemCount: 2,
      subtotal: 114000,
      itemSavings: 14000,
      couponDiscount: 0,
      savings: 14000,
      delivery: 3000,
      total: 103000,
      currency: 'EGP',
    });
    assert.equal(cart.stores.length, 1);
    assert.equal(cart.stores[0].amountToFreeDelivery, 12800);

    const [first] = cart.items;
    assert.equal(first.product.name, 'Nayra Sandalwood Dilka');
    assert.equal(first.variant.label, '250 ml');
    assert.equal(first.discountPercent, 13);
    assert.equal(first.product.variants.length, 2); // for the size picker
    assert.equal(first.maxQty, 5);
    assert.equal(cart.canCheckout, true);
  });

  test('adding the same size again merges; stock is enforced', async () => {
    const { customer, butter } = await seed();
    await addToCart(customer, butter, 'Bag', 2);
    const cart = await addToCart(customer, butter, 'Bag', 1);
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].qty, 3);

    const res = await api()
      .post('/api/v1/cart/items')
      .set(customer.auth)
      .send({ product: String(butter._id), variant: variantOf(butter, 'Bag'), qty: 1 })
      .expect(409);
    assert.equal(res.body.error.code, 'QTY_NOT_AVAILABLE');
    assert.equal(res.body.error.details.maxQty, 3);

    await api()
      .post('/api/v1/cart/items')
      .set(customer.auth)
      .send({ product: String(butter._id), variant: variantOf(butter, 'Bag'), qty: 11 })
      .expect(422);
  });

  test('changing the size merges into a line that already has that size', async () => {
    const { customer, dilka } = await seed();
    let cart = await addToCart(customer, dilka, '100 ml');
    await addToCart(customer, dilka, '250 ml');
    const small = cart.items[0];

    cart = (
      await api()
        .patch(`/api/v1/cart/items/${small._id}`)
        .set(customer.auth)
        .send({ variant: variantOf(dilka, '250 ml') })
        .expect(200)
    ).body.cart;
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].qty, 2);
    assert.equal(cart.items[0].variant.label, '250 ml');

    cart = (await api().patch(`/api/v1/cart/items/${cart.items[0]._id}`).set(customer.auth).send({ qty: 1 }).expect(200)).body.cart;
    assert.equal(cart.items[0].qty, 1);

    cart = (await api().delete(`/api/v1/cart/items/${cart.items[0]._id}`).set(customer.auth).expect(200)).body.cart;
    assert.equal(cart.items.length, 0);
    assert.equal(cart.canCheckout, false);
  });

  test('items that became unavailable are flagged and left out of the totals', async () => {
    const { customer, dilka, butter } = await seed();
    await addToCart(customer, dilka, '250 ml');
    await addToCart(customer, butter, 'Bag');

    await Product.updateOne({ _id: butter._id }, { isActive: false });
    let cart = (await api().get('/api/v1/cart').set(customer.auth).expect(200)).body.cart;
    assert.deepEqual(cart.issues.map((i) => i.code), ['PRODUCT_UNAVAILABLE']);
    assert.equal(cart.summary.itemCount, 1);
    assert.equal(cart.summary.total, 54000 + 3000);
    assert.equal(cart.canCheckout, false);

    await Product.updateOne({ _id: dilka._id, 'variants.label': '250 ml' }, { $set: { 'variants.$.stock': 0 } });
    cart = (await api().get('/api/v1/cart').set(customer.auth).expect(200)).body.cart;
    assert.deepEqual(cart.issues.map((i) => i.code).sort(), ['OUT_OF_STOCK', 'PRODUCT_UNAVAILABLE']);
    assert.equal(cart.summary.total, 0);
  });

  test('the cart requires login', async () => {
    await api().get('/api/v1/cart').expect(401);
  });
});

describe('coupons', () => {
  test('apply, reject, remove', async () => {
    const { admin, customer, dilka, butter } = await seed();
    const coupon = await createCoupon(admin, { code: 'save10', type: 'percent', value: 10, minSubtotal: 50000 });
    assert.equal(coupon.code, 'SAVE10');
    await createCoupon(admin, { code: 'OLD', type: 'fixed', value: 1000, expiresAt: '2020-01-01T00:00:00Z' });
    await createCoupon(admin, { code: 'BIG', type: 'fixed', value: 5000, minSubtotal: 200000 });

    await addToCart(customer, dilka, '250 ml');
    await addToCart(customer, butter, 'Bag');

    let res = await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'nope' }).expect(422);
    assert.equal(res.body.error.code, 'COUPON_INVALID');
    res = await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'old' }).expect(422);
    assert.equal(res.body.error.code, 'COUPON_EXPIRED');
    res = await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'BIG' }).expect(422);
    assert.equal(res.body.error.code, 'COUPON_MIN_SUBTOTAL');
    assert.equal(res.body.error.details.amountNeeded, 100000);

    res = await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'save10' }).expect(200);
    const { cart } = res.body;
    assert.deepEqual(cart.coupon, { code: 'SAVE10', applied: true, discount: 10000, error: null });
    assert.equal(cart.summary.couponDiscount, 10000);
    assert.equal(cart.summary.savings, 24000);
    assert.equal(cart.summary.total, 114000 - 24000 + 3000);

    res = await api().delete('/api/v1/cart/coupon').set(customer.auth).expect(200);
    assert.equal(res.body.cart.coupon, null);
  });

  test('admins manage coupons with validation', async () => {
    const { admin, customer } = await seed();
    let res = await api().post('/api/v1/admin/coupons').set(admin.auth).send({ code: 'HALF', type: 'percent', value: 150 }).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const coupon = await createCoupon(admin, { code: 'HALF', type: 'percent', value: 50 });
    res = await api().post('/api/v1/admin/coupons').set(admin.auth).send({ code: 'half', type: 'fixed', value: 1 }).expect(409);
    assert.equal(res.body.error.code, 'COUPON_EXISTS');

    res = await api().patch(`/api/v1/admin/coupons/${coupon._id}`).set(admin.auth).send({ isActive: false }).expect(200);
    assert.equal(res.body.coupon.isActive, false);

    await api().get('/api/v1/admin/coupons').set(customer.auth).expect(403);
    await api().delete(`/api/v1/admin/coupons/${coupon._id}`).set(admin.auth).expect(200);
  });

  test('a coupon that stops qualifying stays on the cart, is not applied, and blocks checkout', async () => {
    const { admin, customer, dilka, butter } = await seed();
    await createCoupon(admin, { code: 'SAVE10', type: 'percent', value: 10, minSubtotal: 60000 });
    const address = await addAddress(customer);

    await addToCart(customer, dilka, '250 ml');
    const withButter = await addToCart(customer, butter, 'Bag');
    await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'SAVE10' }).expect(200);

    const butterLine = withButter.items.find((i) => i.product.name.includes('Butter'));
    const { cart } = (await api().delete(`/api/v1/cart/items/${butterLine._id}`).set(customer.auth).expect(200)).body;
    assert.equal(cart.coupon.applied, false);
    assert.equal(cart.coupon.error.code, 'COUPON_MIN_SUBTOTAL');
    assert.equal(cart.summary.couponDiscount, 0);
    assert.equal(cart.canCheckout, false);

    const res = await api().post('/api/v1/orders').set(customer.auth).send({ addressId: address._id }).expect(409);
    assert.equal(res.body.error.code, 'COUPON_NOT_APPLICABLE');
  });
});

describe('checkout', () => {
  test('places an order split by store, reserves stock, uses the coupon, empties the cart', async () => {
    const s = await seed();
    await createCoupon(s.admin, { code: 'SAVE10', type: 'percent', value: 10 });
    const address = await addAddress(s.customer);

    await addToCart(s.customer, s.dilka, '250 ml');
    await addToCart(s.customer, s.butter, 'Bag');
    await addToCart(s.customer, s.kisra, 'Pack', 2);
    const { cart } = (await api().post('/api/v1/cart/coupon').set(s.customer.auth).send({ code: 'SAVE10' }).expect(200)).body;

    const order = await placeOrder(s.customer, address);

    assert.match(order.number, /^SM-[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(order.status, 'pending');
    assert.deepEqual(order.pricing, cart.summary);
    assert.deepEqual(order.pricing, {
      itemCount: 4,
      subtotal: 124000,
      itemSavings: 14000,
      couponDiscount: 11000,
      savings: 25000,
      delivery: 5000,
      total: 104000,
      currency: 'EGP',
    });
    assert.deepEqual(order.coupon, { code: 'SAVE10', type: 'percent', value: 10 });
    assert.deepEqual(order.payment, { method: null, status: 'unpaid' });
    assert.equal(order.address.phone, '+201234567890');

    const [camli, food] = order.shipments;
    assert.equal(camli.storeName, 'Camli Beauty');
    assert.deepEqual(
      [camli.itemsTotal, camli.couponDiscount, camli.deliveryFee, camli.total],
      [100000, 10000, 3000, 93000]
    );
    assert.deepEqual([food.itemsTotal, food.couponDiscount, food.deliveryFee, food.total], [10000, 1000, 2000, 11000]);
    assert.deepEqual(
      camli.items.map((i) => [i.name, i.variantLabel, i.qty, i.lineTotal]),
      [
        ['Nayra Sandalwood Dilka', '250 ml', 1, 54000],
        ['Nayra Body Butter Refill Bag', 'Bag', 1, 46000],
      ]
    );
    assert.deepEqual(camli.statusHistory.map((h) => h.status), ['pending']);

    assert.equal(await stockOf(s.dilka, '250 ml'), 4);
    assert.equal(await stockOf(s.butter, 'Bag'), 2);
    assert.equal(await stockOf(s.kisra, 'Pack'), 8);
    assert.equal((await Coupon.findOne({ code: 'SAVE10' })).usedCount, 1);

    const after = (await api().get('/api/v1/cart').set(s.customer.auth).expect(200)).body.cart;
    assert.equal(after.items.length, 0);

    // a second tap on "Checkout" finds an empty cart instead of placing a duplicate
    const again = await api().post('/api/v1/orders').set(s.customer.auth).send({ addressId: address._id }).expect(422);
    assert.equal(again.body.error.code, 'CART_EMPTY');
  });

  test('refuses a missing address and carts with problems', async () => {
    const { customer, dilka } = await seed();
    const address = await addAddress(customer);
    await addToCart(customer, dilka, '250 ml');

    let res = await api().post('/api/v1/orders').set(customer.auth).send({ addressId: '0123456789abcdef01234567' }).expect(422);
    assert.equal(res.body.error.code, 'ADDRESS_NOT_FOUND');

    await Product.updateOne({ _id: dilka._id }, { isActive: false });
    res = await api().post('/api/v1/orders').set(customer.auth).send({ addressId: address._id }).expect(409);
    assert.equal(res.body.error.code, 'CART_HAS_ISSUES');
    assert.equal(res.body.error.details[0].code, 'PRODUCT_UNAVAILABLE');
    assert.equal(await stockOf(dilka, '250 ml'), 5);
  });

  test('if stock runs out mid-checkout, everything already reserved is given back', async (t) => {
    const s = await seed();
    await createCoupon(s.admin, { code: 'SAVE10', type: 'percent', value: 10, usageLimit: 5 });
    const address = await addAddress(s.customer);
    await addToCart(s.customer, s.dilka, '250 ml', 2);
    await addToCart(s.customer, s.butter, 'Bag', 1);
    await api().post('/api/v1/cart/coupon').set(s.customer.auth).send({ code: 'SAVE10' }).expect(200);

    // Someone else buys the last butter between viewing the cart and reserving it
    const realReserve = ordersService.reserveStock;
    let calls = 0;
    t.mock.method(ordersService, 'reserveStock', async (item) => {
      calls += 1;
      return calls === 2 ? false : realReserve(item);
    });

    const res = await api().post('/api/v1/orders').set(s.customer.auth).send({ addressId: address._id }).expect(409);
    assert.equal(res.body.error.code, 'OUT_OF_STOCK');

    assert.equal(await stockOf(s.dilka, '250 ml'), 5, 'the dilka reserved first was put back');
    assert.equal((await Coupon.findOne({ code: 'SAVE10' })).usedCount, 0);
    const cart = (await api().get('/api/v1/cart').set(s.customer.auth).expect(200)).body.cart;
    assert.equal(cart.items.length, 2, 'the cart is kept so the customer can fix it');
  });

  test('a per-customer coupon limit is enforced', async () => {
    const { admin, customer, dilka } = await seed();
    await createCoupon(admin, { code: 'ONCE', type: 'fixed', value: 1000, perUserLimit: 1 });
    const address = await addAddress(customer);

    await addToCart(customer, dilka, '100 ml');
    await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'ONCE' }).expect(200);
    await placeOrder(customer, address);

    await addToCart(customer, dilka, '100 ml');
    const res = await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'ONCE' }).expect(422);
    assert.equal(res.body.error.code, 'COUPON_ALREADY_USED');
  });

  test('orders are private to their owner (and admins)', async () => {
    const { admin, customer, dilka } = await seed();
    const stranger = await createUser();
    const address = await addAddress(customer);
    await addToCart(customer, dilka, '100 ml');
    const order = await placeOrder(customer, address);

    await api().get(`/api/v1/orders/${order._id}`).set(stranger.auth).expect(404);
    await api().get(`/api/v1/orders/${order._id}`).set(admin.auth).expect(200);

    const mine = (await api().get('/api/v1/orders').set(customer.auth).expect(200)).body.items;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].shipments[0].items[0].name, 'Nayra Sandalwood Dilka');
    assert.equal((await api().get('/api/v1/orders').set(stranger.auth).expect(200)).body.items.length, 0);
  });
});

describe('order lifecycle', () => {
  test('the customer can cancel while pending; stock and the coupon use come back', async () => {
    const { admin, customer, dilka, kisra } = await seed();
    await createCoupon(admin, { code: 'SAVE10', type: 'percent', value: 10 });
    const address = await addAddress(customer);
    await addToCart(customer, dilka, '250 ml', 2);
    await addToCart(customer, kisra, 'Pack', 3);
    await api().post('/api/v1/cart/coupon').set(customer.auth).send({ code: 'SAVE10' }).expect(200);
    const order = await placeOrder(customer, address);

    const res = await api().post(`/api/v1/orders/${order._id}/cancel`).set(customer.auth).expect(200);
    assert.equal(res.body.order.status, 'cancelled');
    assert.deepEqual(res.body.order.shipments.map((s) => s.status), ['cancelled', 'cancelled']);

    assert.equal(await stockOf(dilka, '250 ml'), 5);
    assert.equal(await stockOf(kisra, 'Pack'), 10);
    assert.equal((await Coupon.findOne({ code: 'SAVE10' })).usedCount, 0);

    const again = await api().post(`/api/v1/orders/${order._id}/cancel`).set(customer.auth).expect(409);
    assert.equal(again.body.error.code, 'ORDER_NOT_CANCELLABLE');
  });

  test('store confirms and prepares, a driver delivers, and the order tracks it', async () => {
    const s = await seed();
    const address = await addAddress(s.customer);
    await addToCart(s.customer, s.dilka, '250 ml');
    await addToCart(s.customer, s.kisra, 'Pack');
    const order = await placeOrder(s.customer, address);
    const camliShipment = order.shipments.find((sh) => sh.storeName === 'Camli Beauty');
    const foodShipment = order.shipments.find((sh) => sh.storeName === 'Good Food');
    const url = (sh) => `/api/v1/orders/${order._id}/shipments/${sh._id}`;

    // the store sees only its own part of the order
    const storeOrders = (await api().get(`/api/v1/stores/${s.camli._id}/orders`).set(s.vendorA.auth).expect(200)).body.items;
    assert.equal(storeOrders.length, 1);
    assert.equal(storeOrders[0].shipment.storeName, 'Camli Beauty');
    assert.equal(storeOrders[0].shipments, undefined);
    await api().get(`/api/v1/stores/${s.camli._id}/orders`).set(s.vendorB.auth).expect(403);

    let res = await api().patch(url(camliShipment)).set(s.vendorB.auth).send({ status: 'confirmed' }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    res = await api().patch(url(camliShipment)).set(s.vendorA.auth).send({ status: 'delivered' }).expect(422);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');

    await api().patch(url(camliShipment)).set(s.vendorA.auth).send({ status: 'confirmed' }).expect(200);
    res = await api().post(`/api/v1/orders/${order._id}/cancel`).set(s.customer.auth).expect(409);
    assert.equal(res.body.error.code, 'ORDER_NOT_CANCELLABLE');

    await api().patch(url(camliShipment)).set(s.vendorA.auth).send({ status: 'preparing' }).expect(200);
    res = await api().patch(url(camliShipment)).set(s.vendorA.auth).send({ status: 'out_for_delivery' }).expect(422);
    assert.equal(res.body.error.code, 'DRIVER_REQUIRED');

    res = await api()
      .patch(url(camliShipment))
      .set(s.vendorA.auth)
      .send({ status: 'out_for_delivery', driver: String(s.driver.user._id), note: 'On the way' })
      .expect(200);
    assert.equal(res.body.order.shipment.driver, String(s.driver.user._id));

    res = await api().patch(url(camliShipment)).set(s.vendorA.auth).send({ status: 'delivered' }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN_TRANSITION');

    const otherDriver = await createUser({ role: 'driver' });
    await api().patch(url(camliShipment)).set(otherDriver.auth).send({ status: 'delivered' }).expect(403);

    const assigned = (await api().get('/api/v1/driver/shipments').set(s.driver.auth).expect(200)).body.items;
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].address.fullName, 'Mona Ali');

    await api().patch(url(camliShipment)).set(s.driver.auth).send({ status: 'delivered' }).expect(200);

    // one store delivered, the other still pending: the order is only as far as its slowest part
    let tracked = (await api().get(`/api/v1/orders/${order._id}`).set(s.customer.auth).expect(200)).body.order;
    assert.equal(tracked.status, 'pending');
    const camliTracked = tracked.shipments.find((sh) => sh.storeName === 'Camli Beauty');
    assert.deepEqual(
      camliTracked.statusHistory.map((h) => h.status),
      ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']
    );
    assert.equal(camliTracked.statusHistory[3].note, 'On the way');
    assert.ok(camliTracked.deliveredAt);
    assert.equal((await Product.findById(s.dilka._id)).soldCount, 1);

    // the food store cancels its part: stock returns, and the order counts as delivered
    await api().patch(url(foodShipment)).set(s.vendorB.auth).send({ status: 'cancelled' }).expect(200);
    tracked = (await api().get(`/api/v1/orders/${order._id}`).set(s.customer.auth).expect(200)).body.order;
    assert.equal(tracked.status, 'delivered');
    assert.equal(await stockOf(s.kisra, 'Pack'), 10);

    const all = (await api().get('/api/v1/admin/orders?status=delivered').set(s.admin.auth).expect(200)).body.items;
    assert.equal(all.length, 1);
  });
});
