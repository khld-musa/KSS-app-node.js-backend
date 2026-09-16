const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { api, storage, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const Category = require('../models/category');
const Store = require('../models/store');
const Product = require('../models/product');
const RecentView = require('../models/recentView');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const png = () => [PNG, { filename: 'banner.png', contentType: 'image/png' }];

// The customer in the design: Talaat Harb Square, Downtown Cairo
const HERE = { lat: 30.0478, lng: 31.2386 };
const point = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

async function seed() {
  const admin = await createUser({ role: 'admin' });
  const vendor = await createUser({ role: 'vendor' });
  const customer = await createUser();
  const category = await Category.create({ name: 'Skincare' });

  const store = (name, location, extra = {}) =>
    Store.create({ name, owner: vendor.user._id, categoryLabel: 'skin care', ...(location && { location }), ...extra });

  const stores = {
    downtown: await store('Good Food', point(30.0444, 31.2357), { deliveryMinutes: { min: 30, max: 40 }, freeDelivery: true }),
    zamalek: await store('Camli Beauty', point(30.0609, 31.2197)),
    giza: await store('Pyramids Crafts', point(29.9792, 31.1342)),
    alexandria: await store('Alex Spices', point(31.2001, 29.9187)),
    online: await store('Online Only', null),
  };

  const product = (name, extra = {}) =>
    Product.create({
      store: stores.zamalek._id,
      category: category._id,
      name,
      variants: [{ label: 'One', price: 12300, compareAtPrice: 16000, stock: 10 }],
      ...extra,
    });

  return { admin, vendor, customer, category, stores, product };
}

describe('banners', () => {
  test('admins create banners; only live banners with an image are public, in order', async () => {
    const s = await seed();
    const dilka = await s.product('Nayra Sandalwood Dilka');
    const create = (body) => api().post('/api/v1/admin/banners').set(s.admin.auth).send(body).expect(201);

    const beauty = (await create({
      title: 'Beauty Products up to 50% off',
      placement: 'home_top',
      isAd: true,
      sortOrder: 2,
      target: { type: 'product', id: String(dilka._id) },
    })).body.banner;
    const cuisine = (await create({
      title: 'Authentic Sudanese Cuisine',
      placement: 'home_middle',
      target: { type: 'store', id: String(s.stores.downtown._id) },
    })).body.banner;
    const first = (await create({ placement: 'home_top', sortOrder: 1, target: { type: 'url', url: 'https://sudamarket.example/sale' } })).body.banner;
    const noImage = (await create({ placement: 'home_top' })).body.banner;
    const expired = (await create({ placement: 'home_top', endsAt: '2020-01-01T00:00:00Z' })).body.banner;
    const scheduled = (await create({ placement: 'home_top', startsAt: '2099-01-01T00:00:00Z' })).body.banner;

    assert.deepEqual(beauty.target, { type: 'product', id: String(dilka._id), url: null });

    for (const banner of [beauty, cuisine, first, expired, scheduled]) {
      await api().put(`/api/v1/admin/banners/${banner._id}/image`).set(s.admin.auth).attach('image', ...png()).expect(200);
    }

    const top = (await api().get('/api/v1/banners?placement=home_top').expect(200)).body.banners;
    assert.deepEqual(top.map((b) => String(b._id)), [String(first._id), String(beauty._id)]);
    assert.ok(!top.some((b) => String(b._id) === String(noImage._id)));
    assert.equal(top[1].isAd, true);
    assert.match(top[1].image.url, /^\/uploads\/banners\//);

    const all = (await api().get('/api/v1/admin/banners').set(s.admin.auth).expect(200)).body.items;
    assert.equal(all.length, 6);
  });

  test('banner targets and links are validated', async () => {
    const s = await seed();
    const post = (body) => api().post('/api/v1/admin/banners').set(s.admin.auth).send(body);

    let res = await post({ placement: 'home_top', target: { type: 'url', url: 'http://insecure.example' } }).expect(422);
    assert.equal(res.body.error.details[0].field, 'target.url');

    res = await post({ placement: 'home_top', target: { type: 'product', id: '0123456789abcdef01234567' } }).expect(422);
    assert.equal(res.body.error.code, 'INVALID_TARGET');

    res = await post({ placement: 'sidebar' }).expect(422);
    assert.equal(res.body.error.details[0].field, 'placement');

    await api().post('/api/v1/admin/banners').set(s.customer.auth).send({ placement: 'home_top' }).expect(403);
  });

  test('deleting a banner removes its image file', async () => {
    const s = await seed();
    const banner = (await api().post('/api/v1/admin/banners').set(s.admin.auth).send({ placement: 'home_top' }).expect(201)).body.banner;
    const withImage = (await api().put(`/api/v1/admin/banners/${banner._id}/image`).set(s.admin.auth).attach('image', ...png()).expect(200)).body.banner;
    assert.equal(fs.existsSync(storage.resolveKey(withImage.image.key)), true);

    await api().delete(`/api/v1/admin/banners/${banner._id}`).set(s.admin.auth).expect(200);
    assert.equal(fs.existsSync(storage.resolveKey(withImage.image.key)), false);
  });
});

describe('stores near you', () => {
  test('nearest first within the radius, with distance', async () => {
    await seed();
    const res = await api().get(`/api/v1/stores?lat=${HERE.lat}&lng=${HERE.lng}`).expect(200);

    // Alexandria (~180 km) is outside the default 25 km; the store without a location never appears
    assert.deepEqual(res.body.items.map((s) => s.name), ['Good Food', 'Camli Beauty', 'Pyramids Crafts']);
    const [downtown, zamalek, giza] = res.body.items;
    assert.ok(downtown.distanceKm < zamalek.distanceKm && zamalek.distanceKm < giza.distanceKm);
    assert.ok(downtown.distanceKm < 1);
    assert.ok(giza.distanceKm > 10 && giza.distanceKm < 15);
    assert.deepEqual(downtown.deliveryMinutes, { min: 30, max: 40 });
    assert.equal(downtown.freeDelivery, true);
    assert.equal(downtown.owner, undefined);

    const wide = await api().get(`/api/v1/stores?lat=${HERE.lat}&lng=${HERE.lng}&radiusKm=100`).expect(200);
    assert.equal(wide.body.items.length, 3);
  });

  test('pages through nearby stores with a cursor', async () => {
    await seed();
    const names = [];
    let cursor = null;
    do {
      const res = await api()
        .get(`/api/v1/stores?lat=${HERE.lat}&lng=${HERE.lng}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      names.push(...res.body.items.map((s) => s.name));
      cursor = res.body.nextCursor;
    } while (cursor);
    assert.deepEqual(names, ['Good Food', 'Camli Beauty', 'Pyramids Crafts']);
  });

  test('bad location queries are rejected; no location means newest first', async () => {
    await seed();
    let res = await api().get(`/api/v1/stores?lat=${HERE.lat}`).expect(422);
    assert.equal(res.body.error.details[0].field, 'lat');
    res = await api().get('/api/v1/stores?lat=200&lng=31').expect(422);
    res = await api().get(`/api/v1/stores?lat=${HERE.lat}&lng=${HERE.lng}&cursor=garbage`).expect(422);
    assert.equal(res.body.error.code, 'INVALID_CURSOR');

    res = await api().get('/api/v1/stores').expect(200);
    assert.equal(res.body.items.length, 5);
    assert.equal(res.body.items[0].name, 'Online Only');
  });
});

describe('previously browsed products', () => {
  test('logged-in views are recorded, most recent first, without duplicates', async () => {
    const s = await seed();
    const a = await s.product('A');
    const b = await s.product('B');
    const c = await s.product('C');

    for (const p of [a, b, a, c]) {
      await api().get(`/api/v1/products/${p._id}`).set(s.customer.auth).expect(200);
    }

    const res = await api().get('/api/v1/me/recently-viewed').set(s.customer.auth).expect(200);
    assert.deepEqual(res.body.items.map((p) => p.name), ['C', 'A', 'B']);
    assert.equal(res.body.items[0].discountPercent, 23); // 123 vs 160, as on the cards

    // hidden products drop out of the list
    await Product.updateOne({ _id: a._id }, { isActive: false });
    const after = await api().get('/api/v1/me/recently-viewed').set(s.customer.auth).expect(200);
    assert.deepEqual(after.body.items.map((p) => p.name), ['C', 'B']);
  });

  test('guests and bad tokens can still open products; nothing is recorded', async () => {
    const s = await seed();
    const p = await s.product('A');
    await api().get(`/api/v1/products/${p._id}`).expect(200);
    await api().get(`/api/v1/products/${p._id}`).set('Authorization', 'Bearer garbage').expect(200);
    assert.equal(await RecentView.countDocuments(), 0);
    await api().get('/api/v1/me/recently-viewed').expect(401);
  });

  test('only the latest 20 are kept', async () => {
    const s = await seed();
    for (let i = 0; i < 23; i++) {
      const p = await s.product(`P${i}`);
      await api().get(`/api/v1/products/${p._id}`).set(s.customer.auth).expect(200);
    }
    assert.equal(await RecentView.countDocuments({ user: s.customer.user._id }), 20);
    const res = await api().get('/api/v1/me/recently-viewed').set(s.customer.auth).expect(200);
    assert.equal(res.body.items[0].name, 'P22');
    assert.equal(res.body.items[19].name, 'P3');
  });
});

describe('GET /home', () => {
  test('returns every section of the Home screen in one call', async () => {
    const s = await seed();
    await Category.create({ name: 'Groceries', sortOrder: -1 });
    const products = [];
    for (let i = 0; i < 25; i++) products.push(await s.product(`Item ${i}`));
    await Product.updateOne({ _id: products[3]._id }, { soldCount: 50 });
    await Product.updateOne({ _id: products[7]._id }, { soldCount: 80 });

    const banner = (await api().post('/api/v1/admin/banners').set(s.admin.auth).send({ placement: 'home_middle' }).expect(201)).body.banner;
    await api().put(`/api/v1/admin/banners/${banner._id}/image`).set(s.admin.auth).attach('image', ...png()).expect(200);

    await api().get(`/api/v1/products/${products[5]._id}`).set(s.customer.auth).expect(200);

    const home = (await api().get(`/api/v1/home?lat=${HERE.lat}&lng=${HERE.lng}`).set(s.customer.auth).expect(200)).body;

    assert.deepEqual(Object.keys(home.banners), ['home_top', 'home_middle']);
    assert.equal(home.banners.home_middle.length, 1);
    assert.deepEqual(home.categories.map((c) => c.name), ['Groceries', 'Skincare']);
    assert.equal(home.storesNearYou.items[0].name, 'Good Food');
    assert.ok(home.storesNearYou.items[0].distanceKm !== undefined);
    assert.deepEqual(home.previouslyBrowsed.map((p) => p.name), ['Item 5']);
    assert.deepEqual(home.topSelling.slice(0, 2).map((p) => p.name), ['Item 7', 'Item 3']);
    assert.equal(home.topSelling.length, 10);

    // "Keep Scrolling": first page here, the rest from GET /products
    assert.equal(home.feed.items.length, 20);
    assert.ok(home.feed.nextCursor);
    const more = (await api().get(`/api/v1/products?cursor=${home.feed.nextCursor}`).expect(200)).body;
    assert.deepEqual(more.items.map((p) => p.name), ['Item 4', 'Item 3', 'Item 2', 'Item 1', 'Item 0']);
  });

  test('works for guests and without a location', async () => {
    await seed();
    const home = (await api().get('/api/v1/home').expect(200)).body;
    assert.deepEqual(home.previouslyBrowsed, []);
    assert.equal(home.storesNearYou.items.length, 5);
    assert.equal(home.storesNearYou.items[0].distanceKm, undefined);
  });
});

describe('search', () => {
  test('finds products and stores by name', async () => {
    const s = await seed();
    await s.product('Nayra Sandalwood Dilka');
    await s.product('Nayra Body Butter');
    await s.product('Kisra');

    const res = await api().get('/api/v1/search?q=nayra').expect(200);
    assert.equal(res.body.products.items.length, 2);
    assert.equal(res.body.stores.items.length, 0);

    const stores = await api().get('/api/v1/search?q=camli').expect(200);
    assert.deepEqual(stores.body.stores.items.map((st) => st.name), ['Camli Beauty']);

    await api().get('/api/v1/search?q=').expect(422);
  });
});
