const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { api, storage, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');

// Just the PNG signature plus a few bytes: enough for type sniffing
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const png = (name = 'photo.png') => [PNG, { filename: name, contentType: 'image/png' }];

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

// Admin, a vendor, a category, and the vendor's store with two collections
async function seed() {
  const admin = await createUser({ role: 'admin' });
  const vendor = await createUser();

  const category = (
    await api().post('/api/v1/admin/categories').set(admin.auth).send({ name: 'Skincare', sortOrder: 2 }).expect(201)
  ).body.category;

  const store = (
    await api()
      .post('/api/v1/admin/stores')
      .set(admin.auth)
      .send({
        name: 'Camli Beauty',
        owner: String(vendor.user._id),
        categoryLabel: 'skin care',
        location: { lat: 30.0444, lng: 31.2357 },
        deliveryMinutes: { min: 30, max: 40 },
        deliveryFee: 3000,
        freeDeliveryThreshold: 100000,
        collections: [
          { name: 'Best Sellers', icon: '🔥' },
          { name: 'Body Care', icon: '🧴' },
        ],
      })
      .expect(201)
  ).body.store;

  return { admin, vendor, category, store };
}

const productBody = (s, overrides = {}) => ({
  name: 'Nayra Sandalwood Dilka',
  description: 'A refreshing body scrub',
  category: s.category._id,
  collections: [s.store.collections[1]._id],
  attributes: [
    { label: 'Skin Type', value: 'All skin types' },
    { label: 'Formulation', value: 'paste' },
  ],
  variants: [
    { label: '100 ml', price: 30000, compareAtPrice: 35000, stock: 5 },
    { label: '250 ml', price: 54000, compareAtPrice: 62000, stock: 0 },
  ],
  ...overrides,
});

async function createProduct(s, overrides) {
  const res = await api()
    .post(`/api/v1/stores/${s.store._id}/products`)
    .set(s.vendor.auth)
    .send(productBody(s, overrides))
    .expect(201);
  return res.body.product;
}

describe('categories', () => {
  test('admin manages categories; the public list is sorted', async () => {
    const { admin, category } = await seed();
    await api().post('/api/v1/admin/categories').set(admin.auth).send({ name: 'Food', sortOrder: 1 }).expect(201);

    const list = await api().get('/api/v1/categories').expect(200);
    assert.deepEqual(list.body.categories.map((c) => c.name), ['Food', 'Skincare']);

    const dup = await api().post('/api/v1/admin/categories').set(admin.auth).send({ name: 'skincare' }).expect(409);
    assert.equal(dup.body.error.code, 'CATEGORY_EXISTS');

    const renamed = await api()
      .patch(`/api/v1/admin/categories/${category._id}`)
      .set(admin.auth)
      .send({ name: 'Skin Care' })
      .expect(200);
    assert.equal(renamed.body.category.name, 'Skin Care');

    const icon = await api()
      .put(`/api/v1/admin/categories/${category._id}/icon`)
      .set(admin.auth)
      .attach('image', ...png())
      .expect(200);
    assert.match(icon.body.category.icon.url, /^\/uploads\/categories\/[\w-]+\.png$/);
    const served = await api().get(icon.body.category.icon.url).expect(200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
  });

  test('only admins can write categories', async () => {
    const user = await createUser();
    await api().post('/api/v1/admin/categories').send({ name: 'X' }).expect(401);
    const res = await api().post('/api/v1/admin/categories').set(user.auth).send({ name: 'X' }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('a category in use cannot be deleted', async () => {
    const s = await seed();
    const product = await createProduct(s);

    const res = await api().delete(`/api/v1/admin/categories/${s.category._id}`).set(s.admin.auth).expect(409);
    assert.equal(res.body.error.code, 'CATEGORY_IN_USE');

    await api().delete(`/api/v1/products/${product._id}`).set(s.vendor.auth).expect(200);
    await api().delete(`/api/v1/admin/categories/${s.category._id}`).set(s.admin.auth).expect(200);
  });
});

describe('stores', () => {
  test('admin creates a store; the owner becomes a vendor; the public view hides the owner', async () => {
    const s = await seed();

    const me = await api().get('/api/v1/me').set(s.vendor.auth).expect(200);
    assert.equal(me.body.user.role, 'vendor');

    const res = await api().get(`/api/v1/stores/${s.store._id}`).expect(200);
    assert.equal(res.body.store.owner, undefined);
    assert.deepEqual(res.body.store.location, { lat: 30.0444, lng: 31.2357 });
    assert.deepEqual(res.body.store.collections.map((c) => c.name), ['Best Sellers', 'Body Care']);
    assert.equal(res.body.store.freeDeliveryThreshold, 100000);

    const list = await api().get('/api/v1/stores').expect(200);
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].categoryLabel, 'skin care');
    assert.equal(list.body.nextCursor, null);
  });

  test('only the owner or an admin can edit; vendors cannot touch admin-only fields', async () => {
    const s = await seed();
    const otherVendor = await createUser();
    await api()
      .post('/api/v1/admin/stores')
      .set(s.admin.auth)
      .send({ name: 'Other', owner: String(otherVendor.user._id) })
      .expect(201);

    let res = await api().patch(`/api/v1/stores/${s.store._id}`).set(otherVendor.auth).send({ name: 'Hijack' }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');

    res = await api().patch(`/api/v1/stores/${s.store._id}`).set(s.vendor.auth).send({ name: 'Camli' }).expect(200);
    assert.equal(res.body.store.name, 'Camli');

    res = await api().patch(`/api/v1/stores/${s.store._id}`).set(s.vendor.auth).send({ isActive: false }).expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN_FIELD');

    await api().patch(`/api/v1/stores/${s.store._id}`).set(s.admin.auth).send({ isActive: false }).expect(200);
    await api().get(`/api/v1/stores/${s.store._id}`).expect(404);
  });

  test('removing a collection pulls it from the store’s products', async () => {
    const s = await seed();
    const product = await createProduct(s); // in "Body Care"
    assert.equal(product.collections.length, 1);

    const [bestSellers] = s.store.collections;
    await api()
      .patch(`/api/v1/stores/${s.store._id}`)
      .set(s.vendor.auth)
      .send({ collections: [{ _id: bestSellers._id, name: 'Best Sellers', icon: '🔥' }, { name: 'Face Care' }] })
      .expect(200);

    const res = await api().get(`/api/v1/products/${product._id}`).expect(200);
    assert.deepEqual(res.body.product.collections, []);

    // an unknown collection _id is rejected
    const bad = await api()
      .patch(`/api/v1/stores/${s.store._id}`)
      .set(s.vendor.auth)
      .send({ collections: [{ _id: String(s.category._id), name: 'Nope' }] })
      .expect(422);
    assert.equal(bad.body.error.code, 'INVALID_COLLECTION');
  });

  test('uploading a new logo deletes the old one', async () => {
    const s = await seed();
    const first = await api().put(`/api/v1/stores/${s.store._id}/logo`).set(s.vendor.auth).attach('image', ...png()).expect(200);
    const second = await api().put(`/api/v1/stores/${s.store._id}/logo`).set(s.vendor.auth).attach('image', ...png()).expect(200);
    assert.equal(fs.existsSync(storage.resolveKey(first.body.store.logo.key)), false);
    assert.equal(fs.existsSync(storage.resolveKey(second.body.store.logo.key)), true);
  });

  test('a store with products cannot be deleted', async () => {
    const s = await seed();
    await createProduct(s);
    const res = await api().delete(`/api/v1/admin/stores/${s.store._id}`).set(s.admin.auth).expect(409);
    assert.equal(res.body.error.code, 'STORE_HAS_PRODUCTS');
  });
});

describe('products', () => {
  test('prices, discounts and stock are derived, never stored by the client', async () => {
    const s = await seed();
    const created = await createProduct(s);

    // cheapest variant drives the card: 30000 vs 35000 -> 14%
    assert.equal(created.minPrice, 30000);
    assert.equal(created.discountPercent, 14);

    const { product } = (await api().get(`/api/v1/products/${created._id}`).expect(200)).body;
    assert.equal(product.store.name, 'Camli Beauty');
    assert.equal(product.category.name, 'Skincare');
    const big = product.variants.find((v) => v.label === '250 ml');
    assert.equal(big.discountPercent, 13); // 54000 vs 62000
    assert.equal(big.inStock, false);
    assert.equal(product.attributes[0].label, 'Skin Type');
    assert.equal(product.id, undefined);
  });

  test('invalid products are rejected with field details', async () => {
    const s = await seed();
    const post = (body) => api().post(`/api/v1/stores/${s.store._id}/products`).set(s.vendor.auth).send(body);

    let res = await post(productBody(s, { variants: [{ label: '100 ml', price: 500, compareAtPrice: 400 }] })).expect(422);
    assert.equal(res.body.error.details[0].field, 'variants.0.compareAtPrice');

    res = await post(productBody(s, { variants: [] })).expect(422);
    assert.equal(res.body.error.details[0].field, 'variants');

    res = await post(productBody(s, { variants: [{ label: 'A', price: 1 }, { label: 'a', price: 2 }] })).expect(422);
    assert.equal(res.body.error.details[0].message, 'Variant labels must be unique');

    res = await post(productBody(s, { variants: [{ label: 'A', price: 12.5 }] })).expect(422);
    assert.equal(res.body.error.details[0].field, 'variants.0.price');

    res = await post(productBody(s, { category: '0123456789abcdef01234567' })).expect(422);
    assert.equal(res.body.error.code, 'INVALID_CATEGORY');
  });

  test('a product can only use its own store’s collections', async () => {
    const s = await seed();
    const other = await api()
      .post('/api/v1/admin/stores')
      .set(s.admin.auth)
      .send({ name: 'Other', owner: String(s.vendor.user._id), collections: [{ name: 'Elsewhere' }] })
      .expect(201);

    const res = await api()
      .post(`/api/v1/stores/${s.store._id}/products`)
      .set(s.vendor.auth)
      .send(productBody(s, { collections: [other.body.store.collections[0]._id] }))
      .expect(422);
    assert.equal(res.body.error.code, 'INVALID_COLLECTION');
  });

  test('only the store owner or an admin can create and edit products', async () => {
    const s = await seed();
    const user = await createUser();
    const otherVendor = await createUser({ role: 'vendor' });
    const product = await createProduct(s);

    await api().post(`/api/v1/stores/${s.store._id}/products`).send(productBody(s)).expect(401);
    await api().post(`/api/v1/stores/${s.store._id}/products`).set(user.auth).send(productBody(s)).expect(403);
    await api().post(`/api/v1/stores/${s.store._id}/products`).set(otherVendor.auth).send(productBody(s)).expect(403);
    await api().patch(`/api/v1/products/${product._id}`).set(otherVendor.auth).send({ name: 'x' }).expect(403);
    await api().patch(`/api/v1/products/${product._id}`).set(s.admin.auth).send({ name: 'By admin' }).expect(200);
  });

  test('replacing variants recomputes the price; keeping an _id keeps the variant', async () => {
    const s = await seed();
    const product = await createProduct(s);
    const keep = product.variants[1];

    const res = await api()
      .patch(`/api/v1/products/${product._id}`)
      .set(s.vendor.auth)
      .send({ variants: [{ _id: keep._id, label: '250 ml', price: 56000, stock: 3 }, { label: '200 ml', price: 45000 }] })
      .expect(200);

    assert.equal(res.body.product.minPrice, 45000);
    assert.equal(res.body.product.discountPercent, 0);
    assert.equal(res.body.product.variants.find((v) => v.label === '250 ml')._id, keep._id);
  });

  test('inactive products are hidden from the public', async () => {
    const s = await seed();
    const product = await createProduct(s);
    await api().patch(`/api/v1/products/${product._id}`).set(s.vendor.auth).send({ isActive: false }).expect(200);

    await api().get(`/api/v1/products/${product._id}`).expect(404);
    const list = await api().get('/api/v1/products').expect(200);
    assert.equal(list.body.items.length, 0);
  });
});

describe('product listing', () => {
  // Five products priced 100..500 EGP, created in shuffled order
  async function seedListing() {
    const s = await seed();
    const [bestSellers] = s.store.collections;
    for (const egp of [300, 100, 500, 200, 400]) {
      await createProduct(s, {
        name: `Product ${egp}`,
        collections: egp === 200 ? [bestSellers._id] : [],
        variants: [{ label: 'One', price: egp * 100, compareAtPrice: egp * 120 }],
      });
    }
    return s;
  }

  async function collectAllPages(url) {
    const prices = [];
    let cursor = null;
    let pages = 0;
    do {
      const sep = url.includes('?') ? '&' : '?';
      const res = await api()
        .get(`${url}${sep}limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      prices.push(...res.body.items.map((p) => p.minPrice));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor);
    return { prices, pages };
  }

  test('price sorting paginates with cursors, without gaps or repeats', async () => {
    await seedListing();

    const asc = await collectAllPages('/api/v1/products?sort=price_asc');
    assert.deepEqual(asc.prices, [10000, 20000, 30000, 40000, 50000]);
    assert.equal(asc.pages, 3);

    const desc = await collectAllPages('/api/v1/products?sort=price_desc');
    assert.deepEqual(desc.prices, [50000, 40000, 30000, 20000, 10000]);

    const newest = await collectAllPages('/api/v1/products');
    assert.deepEqual(newest.prices, [40000, 20000, 50000, 10000, 30000]);
  });

  test('ties on the sort field do not drop or repeat items', async () => {
    const s = await seed();
    for (let i = 0; i < 5; i++) {
      await createProduct(s, { name: `Same ${i}`, variants: [{ label: 'One', price: 1000 }] });
    }
    const res = await collectAllPages('/api/v1/products?sort=price_asc');
    assert.equal(res.prices.length, 5);
  });

  test('filters: search, price range, collection, store', async () => {
    const s = await seedListing();
    const count = async (url) => (await api().get(url).expect(200)).body.items.length;

    assert.equal(await count('/api/v1/products?q=product%203'), 1);
    assert.equal(await count('/api/v1/products?q=.*'), 0); // regex input is escaped
    assert.equal(await count('/api/v1/products?minPrice=20000&maxPrice=40000'), 3);
    assert.equal(await count(`/api/v1/products?collection=${s.store.collections[0]._id}`), 1);
    assert.equal(await count(`/api/v1/products?store=${s.store._id}`), 5);
    assert.equal(await count(`/api/v1/stores/${s.store._id}/products?sort=price_asc&maxPrice=10000`), 1);
    assert.equal(await count(`/api/v1/products?category=${s.category._id}`), 5);
  });

  test('cards are lightweight: one image, store name, no variants', async () => {
    const s = await seed();
    const product = await createProduct(s);
    await api()
      .post(`/api/v1/products/${product._id}/images`)
      .set(s.vendor.auth)
      .attach('images', ...png('a.png'))
      .attach('images', ...png('b.png'))
      .expect(201);

    const [card] = (await api().get('/api/v1/products').expect(200)).body.items;
    assert.equal(card.images.length, 1);
    assert.equal(card.store.name, 'Camli Beauty');
    assert.equal(card.discountPercent, 14);
    assert.equal(card.variants, undefined);
    assert.equal(card.attributes, undefined);
  });

  test('bad query parameters are rejected', async () => {
    let res = await api().get('/api/v1/products?cursor=not-a-cursor').expect(422);
    assert.equal(res.body.error.code, 'INVALID_CURSOR');
    res = await api().get('/api/v1/products?sort=cheapest').expect(422);
    assert.equal(res.body.error.details[0].field, 'sort');
    res = await api().get('/api/v1/products?minPrice=500&maxPrice=100').expect(422);
    assert.equal(res.body.error.details[0].field, 'minPrice');
    await api().get('/api/v1/stores/0123456789abcdef01234567/products').expect(404);
  });
});

describe('product images', () => {
  test('upload, reject non-images, delete', async () => {
    const s = await seed();
    const product = await createProduct(s);
    const url = `/api/v1/products/${product._id}/images`;

    const up = await api().post(url).set(s.vendor.auth).attach('images', ...png('a.png')).attach('images', ...png('b.png')).expect(201);
    assert.equal(up.body.images.length, 2);

    // a text file renamed to .png is still not an image
    let res = await api()
      .post(url)
      .set(s.vendor.auth)
      .attach('images', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' })
      .expect(415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_IMAGE');

    res = await api().post(url).set(s.vendor.auth).field('nothing', 'here').expect(422);
    assert.equal(res.body.error.code, 'NO_FILE');

    res = await api().post(url).set(s.vendor.auth).attach('photo', ...png()).expect(422);
    assert.equal(res.body.error.code, 'UPLOAD_ERROR');

    // the rejected uploads above wrote nothing
    assert.equal(fs.readdirSync(storage.resolveKey(`products/${product._id}`)).length, 2);

    const [first] = up.body.images;
    await api().get(first.url).expect(200).expect('Content-Type', 'image/png');
    res = await api().delete(`${url}/${first._id}`).set(s.vendor.auth).expect(200);
    assert.equal(res.body.images.length, 1);
    assert.equal(fs.existsSync(storage.resolveKey(first.key)), false);
    await api().get(first.url).expect(404);

    await api().delete(`${url}/${first._id}`).set(s.vendor.auth).expect(404);
  });
});

describe('admin users', () => {
  test('list, filter, and change roles safely', async () => {
    const s = await seed();
    const user = await createUser({ firstName: 'Moneira' });

    let res = await api().get('/api/v1/admin/users?role=vendor').set(s.admin.auth).expect(200);
    assert.equal(res.body.items.length, 1);
    res = await api().get('/api/v1/admin/users?q=moneira').set(s.admin.auth).expect(200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].passwordHash, undefined);

    res = await api().patch(`/api/v1/admin/users/${user.user._id}/role`).set(s.admin.auth).send({ role: 'driver' }).expect(200);
    assert.equal(res.body.user.role, 'driver');

    await api().patch(`/api/v1/admin/users/${user.user._id}/role`).set(s.admin.auth).send({ role: 'king' }).expect(422);

    res = await api().patch(`/api/v1/admin/users/${s.admin.user._id}/role`).set(s.admin.auth).send({ role: 'user' }).expect(422);
    assert.equal(res.body.error.code, 'CANNOT_CHANGE_OWN_ROLE');

    res = await api().patch(`/api/v1/admin/users/${s.vendor.user._id}/role`).set(s.admin.auth).send({ role: 'user' }).expect(409);
    assert.equal(res.body.error.code, 'USER_OWNS_STORES');

    await api().get('/api/v1/admin/users').set(s.vendor.auth).expect(403);
  });
});
