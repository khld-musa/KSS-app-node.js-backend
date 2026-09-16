const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const Category = require('../models/category');
const Store = require('../models/store');
const Product = require('../models/product');
const Order = require('../models/order');
const WishlistItem = require('../models/wishlistItem');

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

async function seed() {
  const admin = await createUser({ role: 'admin' });
  const vendor = await createUser({ role: 'vendor' });
  const customer = await createUser({ firstName: 'Moneira', lastName: 'Badraldeen' });
  const other = await createUser({ firstName: 'Mina', lastName: 'Idris' });

  const skincare = await Category.create({ name: 'Skincare' });
  const food = await Category.create({ name: 'Food' });
  const camli = await Store.create({ name: 'Camli Beauty', owner: vendor.user._id });
  const goodFood = await Store.create({ name: 'Good Food', owner: vendor.user._id });

  const product = (name, store, category, extra = {}) =>
    Product.create({
      store: store._id,
      category: category._id,
      name,
      variants: [{ label: 'One', price: 12300, compareAtPrice: 16000, stock: 10 }],
      ...extra,
    });

  const dilka = await product('Nayra Sandalwood Dilka', camli, skincare);
  const butter = await product('Nayra Body Butter', camli, skincare, { soldCount: 5 });
  const scrub = await product('Camli Scrub', camli, skincare, { soldCount: 9 });
  const kisra = await product('Kisra', goodFood, food, { soldCount: 20 });
  const dates = await product('Sudanese Dates', goodFood, food, { soldCount: 1 });

  return { admin, vendor, customer, other, camli, goodFood, dilka, butter, scrub, kisra, dates };
}

// An order for `product` placed by `user`, with its shipment in `status`
function orderFor(user, store, product, status = 'delivered') {
  return Order.create({
    number: `SM-TEST${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    user: user.user._id,
    status,
    shipments: [
      {
        store: store._id,
        storeName: store.name,
        items: [
          {
            product: product._id,
            variant: product.variants[0]._id,
            name: product.name,
            variantLabel: 'One',
            price: 12300,
            qty: 1,
            lineTotal: 12300,
          },
        ],
        itemsTotal: 12300,
        deliveryFee: 0,
        total: 12300,
        status,
      },
    ],
  });
}

describe('wishlist', () => {
  test('save, list, ids and remove; tapping twice is harmless', async () => {
    const s = await seed();
    const auth = s.customer.auth;

    let res = await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(auth).expect(201);
    assert.deepEqual(res.body, { success: true, wishlisted: true, count: 1 });
    res = await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(auth).expect(200);
    assert.equal(res.body.count, 1);
    await api().post(`/api/v1/wishlist/${s.kisra._id}`).set(auth).expect(201);

    res = await api().get('/api/v1/wishlist').set(auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Kisra', 'Nayra Sandalwood Dilka']);
    assert.equal(res.body.items[0].discountPercent, 23);

    res = await api().get('/api/v1/wishlist/ids').set(auth).expect(200);
    assert.deepEqual(res.body.ids.sort(), [String(s.dilka._id), String(s.kisra._id)].sort());
    assert.equal(res.body.count, 2);

    res = await api().delete(`/api/v1/wishlist/${s.kisra._id}`).set(auth).expect(200);
    assert.deepEqual(res.body, { success: true, wishlisted: false, count: 1 });
    await api().delete(`/api/v1/wishlist/${s.kisra._id}`).set(auth).expect(200);

    // someone else's wishlist is separate
    res = await api().get('/api/v1/wishlist/ids').set(s.other.auth).expect(200);
    assert.equal(res.body.count, 0);
  });

  test('hidden or unknown products cannot be saved, and drop out of the list', async () => {
    const s = await seed();
    await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(s.customer.auth).expect(201);
    await Product.updateOne({ _id: s.dilka._id }, { isActive: false });

    const res = await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(s.customer.auth).expect(404);
    assert.equal(res.body.error.code, 'PRODUCT_NOT_FOUND');
    await api().post('/api/v1/wishlist/0123456789abcdef01234567').set(s.customer.auth).expect(404);

    const list = await api().get('/api/v1/wishlist').set(s.customer.auth).expect(200);
    assert.equal(list.body.items.length, 0);
    await api().get('/api/v1/wishlist').expect(401);
  });

  test('the product page and Home show the heart state and badge', async () => {
    const s = await seed();
    await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(s.customer.auth).expect(201);

    let res = await api().get(`/api/v1/products/${s.dilka._id}`).set(s.customer.auth).expect(200);
    assert.equal(res.body.product.isWishlisted, true);
    assert.equal(res.body.product.name, 'Nayra Sandalwood Dilka');
    res = await api().get(`/api/v1/products/${s.butter._id}`).set(s.customer.auth).expect(200);
    assert.equal(res.body.product.isWishlisted, false);
    res = await api().get(`/api/v1/products/${s.dilka._id}`).expect(200);
    assert.equal(res.body.product.isWishlisted, false);

    res = await api().get('/api/v1/home').set(s.customer.auth).expect(200);
    assert.equal(res.body.wishlistCount, 1);
    res = await api().get('/api/v1/home').expect(200);
    assert.equal(res.body.wishlistCount, null);
  });

  test('"Move to Wishlist" from the cart', async () => {
    const s = await seed();
    const variant = String(s.dilka.variants[0]._id);
    let cart = (
      await api().post('/api/v1/cart/items').set(s.customer.auth).send({ product: String(s.dilka._id), variant }).expect(201)
    ).body.cart;
    await api().post('/api/v1/cart/items').set(s.customer.auth).send({ product: String(s.kisra._id), variant: String(s.kisra.variants[0]._id) }).expect(201);

    const res = await api().post(`/api/v1/cart/items/${cart.items[0]._id}/move-to-wishlist`).set(s.customer.auth).expect(200);
    cart = res.body.cart;
    assert.deepEqual(cart.items.map((i) => i.product.name), ['Kisra']);
    assert.equal(res.body.wishlistCount, 1);
    assert.equal(await WishlistItem.countDocuments({ user: s.customer.user._id, product: s.dilka._id }), 1);

    await api().post('/api/v1/cart/items/0123456789abcdef01234567/move-to-wishlist').set(s.customer.auth).expect(404);
  });

  test('deleting a product removes it from wishlists', async () => {
    const s = await seed();
    await api().post(`/api/v1/wishlist/${s.dilka._id}`).set(s.customer.auth).expect(201);
    await api().delete(`/api/v1/products/${s.dilka._id}`).set(s.vendor.auth).expect(200);
    assert.equal(await WishlistItem.countDocuments(), 0);
  });
});

describe('reviews', () => {
  test('only customers whose order was delivered can review', async () => {
    const s = await seed();
    const post = (user) => api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(user.auth).send({ rating: 4 });

    let res = await post(s.customer).expect(403);
    assert.equal(res.body.error.code, 'NOT_PURCHASED');

    await orderFor(s.customer, s.camli, s.dilka, 'out_for_delivery');
    res = await post(s.customer).expect(403);
    assert.equal(res.body.error.code, 'NOT_PURCHASED');

    res = await api().get(`/api/v1/products/${s.dilka._id}/my-review`).set(s.customer.auth).expect(200);
    assert.deepEqual(res.body, { success: true, canReview: false, review: null });

    await orderFor(s.customer, s.camli, s.dilka, 'delivered');
    res = await api().get(`/api/v1/products/${s.dilka._id}/my-review`).set(s.customer.auth).expect(200);
    assert.equal(res.body.canReview, true);

    await api().post(`/api/v1/products/${s.dilka._id}/reviews`).send({ rating: 4 }).expect(401);
  });

  test('reviews update the product rating, list newest first with author names', async () => {
    const s = await seed();
    await orderFor(s.customer, s.camli, s.dilka);
    await orderFor(s.other, s.camli, s.dilka);

    const mine = await api()
      .post(`/api/v1/products/${s.dilka._id}/reviews`)
      .set(s.customer.auth)
      .send({ rating: 4, comment: 'ينعم و يرطب و ريحتو حلوه شديد' })
      .expect(201);
    assert.deepEqual(mine.body.review.author, { firstName: 'Moneira', lastName: 'Badraldeen' });
    assert.equal(mine.body.review.user, undefined);

    let res = await api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(s.customer.auth).send({ rating: 5 }).expect(409);
    assert.equal(res.body.error.code, 'ALREADY_REVIEWED');

    await api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(s.other.auth).send({ rating: 5, comment: 'I love it' }).expect(201);

    res = await api().get(`/api/v1/products/${s.dilka._id}/reviews`).expect(200);
    assert.deepEqual(res.body.summary, { ratingAvg: 4.5, ratingCount: 2 });
    assert.deepEqual(res.body.items.map((r) => [r.author.firstName, r.rating]), [['Mina', 5], ['Moneira', 4]]);

    const product = (await api().get(`/api/v1/products/${s.dilka._id}`).expect(200)).body.product;
    assert.equal(product.ratingAvg, 4.5);
    assert.equal(product.ratingCount, 2);

    res = await api().get(`/api/v1/products/${s.dilka._id}/my-review`).set(s.customer.auth).expect(200);
    assert.equal(res.body.canReview, false);
    assert.equal(res.body.review.rating, 4);
  });

  test('authors edit and delete their reviews; admins can delete any', async () => {
    const s = await seed();
    await orderFor(s.customer, s.camli, s.dilka);
    await orderFor(s.other, s.camli, s.dilka);
    const mine = (await api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(s.customer.auth).send({ rating: 2 }).expect(201)).body.review;
    const theirs = (await api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(s.other.auth).send({ rating: 4 }).expect(201)).body.review;

    let res = await api().patch(`/api/v1/reviews/${mine._id}`).set(s.customer.auth).send({ rating: 5, comment: 'Better after a week' }).expect(200);
    assert.equal(res.body.review.comment, 'Better after a week');
    assert.equal((await Product.findById(s.dilka._id)).ratingAvg, 4.5);

    res = await api().patch(`/api/v1/reviews/${theirs._id}`).set(s.customer.auth).send({ rating: 1 }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    await api().delete(`/api/v1/reviews/${theirs._id}`).set(s.customer.auth).expect(403);

    await api().delete(`/api/v1/reviews/${mine._id}`).set(s.customer.auth).expect(200);
    assert.equal((await Product.findById(s.dilka._id)).ratingAvg, 4);

    await api().delete(`/api/v1/reviews/${theirs._id}`).set(s.admin.auth).expect(200);
    const product = await Product.findById(s.dilka._id);
    assert.deepEqual([product.ratingAvg, product.ratingCount], [0, 0]);
  });

  test('ratings are whole stars from 1 to 5', async () => {
    const s = await seed();
    await orderFor(s.customer, s.camli, s.dilka);
    const post = (body) => api().post(`/api/v1/products/${s.dilka._id}/reviews`).set(s.customer.auth).send(body);
    for (const rating of [0, 6, 4.5, '5']) {
      const res = await post({ rating }).expect(422);
      assert.equal(res.body.error.details[0].field, 'rating');
    }
    await post({ rating: 5, comment: 'x'.repeat(1001) }).expect(422);
  });
});

describe('recommendations', () => {
  test('"Explore More From This Brand": same store, best sellers first, not the product itself', async () => {
    const s = await seed();
    const res = await api().get(`/api/v1/products/${s.dilka._id}/more-from-store`).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Camli Scrub', 'Nayra Body Butter']);
    await api().get('/api/v1/products/0123456789abcdef01234567/more-from-store').expect(404);
  });

  test('"Product Matches For You": related to the cart first, then best sellers, never cart items', async () => {
    const s = await seed();
    await api().post('/api/v1/cart/items').set(s.customer.auth).send({ product: String(s.dilka._id), variant: String(s.dilka.variants[0]._id) }).expect(201);

    let res = await api().get('/api/v1/cart/recommendations?limit=3').set(s.customer.auth).expect(200);
    // Camli products first (same store/category), then the top overall seller fills the last slot
    assert.deepEqual(res.body.items.map((p) => p.name), ['Camli Scrub', 'Nayra Body Butter', 'Kisra']);

    res = await api().get('/api/v1/cart/recommendations?limit=10').set(s.customer.auth).expect(200);
    assert.ok(!res.body.items.some((p) => p.name === 'Nayra Sandalwood Dilka'));
    assert.equal(res.body.items.length, 4);

    // empty cart: best sellers
    res = await api().get('/api/v1/cart/recommendations?limit=2').set(s.other.auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['Kisra', 'Camli Scrub']);
  });
});
