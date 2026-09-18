const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const User = require('../models/user');
const Store = require('../models/store');
const Order = require('../models/order');
const Cart = require('../models/cart');

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

const newUser = {
  firstName: 'Hassan',
  lastName: 'Ali',
  phone: '01122223333',
  email: 'Hassan@Example.com',
  password: 'Driver-pass1',
  role: 'driver',
};

// returns the supertest request, so callers can chain .expect()
function login(phone, password) {
  return api().post('/api/v1/auth/login').send({ phone, password });
}

describe('admin creates users', () => {
  test('a created account is verified and can sign in right away', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await api().post('/api/v1/admin/users').set(admin.auth).send(newUser).expect(201);

    assert.equal(res.body.user.phone, '+201122223333');
    assert.equal(res.body.user.email, 'hassan@example.com');
    assert.equal(res.body.user.role, 'driver');
    assert.equal(res.body.user.phoneVerified, true);
    assert.equal(res.body.user.isActive, true);
    assert.equal(res.body.user.passwordHash, undefined);

    const signIn = await login('01122223333', 'Driver-pass1').expect(200);
    assert.equal(signIn.body.user.role, 'driver');
  });

  test('phone and email must be unique; input is validated', async () => {
    const admin = await createUser({ role: 'admin' });
    await api().post('/api/v1/admin/users').set(admin.auth).send(newUser).expect(201);

    let res = await api().post('/api/v1/admin/users').set(admin.auth).send({ ...newUser, email: undefined }).expect(409);
    assert.equal(res.body.error.code, 'PHONE_TAKEN');
    res = await api().post('/api/v1/admin/users').set(admin.auth).send({ ...newUser, phone: '01122224444' }).expect(409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');

    res = await api().post('/api/v1/admin/users').set(admin.auth).send({ ...newUser, phone: '12', password: 'short' }).expect(422);
    assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ['password', 'phone']);
    res = await api().post('/api/v1/admin/users').set(admin.auth).send({ ...newUser, phone: '01122225555', email: '', role: 'boss' }).expect(422);
    assert.equal(res.body.error.details[0].field, 'role');
  });

  test('only admins manage users', async () => {
    const vendor = await createUser({ role: 'vendor' });
    const someone = await createUser();
    await api().post('/api/v1/admin/users').set(vendor.auth).send(newUser).expect(403);
    await api().get(`/api/v1/admin/users/${someone.user._id}`).set(vendor.auth).expect(403);
    await api().patch(`/api/v1/admin/users/${someone.user._id}/status`).set(vendor.auth).send({ isActive: false }).expect(403);
  });
});

describe('admin manages existing users', () => {
  test('details include stores owned and order counts', async () => {
    const admin = await createUser({ role: 'admin' });
    const vendor = await createUser({ role: 'vendor', firstName: 'Nayra' });
    await Store.create({ name: 'Camli Beauty', owner: vendor.user._id });
    await Order.create({
      number: 'SM-USERTEST',
      user: vendor.user._id,
      shipments: [{ store: vendor.user._id, storeName: 'X', items: [], itemsTotal: 0, deliveryFee: 0, total: 0 }],
    });

    const res = await api().get(`/api/v1/admin/users/${vendor.user._id}`).set(admin.auth).expect(200);
    assert.equal(res.body.user.firstName, 'Nayra');
    assert.deepEqual(res.body.stores.map((s) => s.name), ['Camli Beauty']);
    assert.equal(res.body.orderCount, 1);
    assert.equal(res.body.deliveryCount, 0);
    await api().get('/api/v1/admin/users/0123456789abcdef01234567').set(admin.auth).expect(404);
  });

  test('edit name, phone and email; uniqueness is enforced; email can be removed', async () => {
    const admin = await createUser({ role: 'admin' });
    const other = await createUser({ email: 'taken@example.com' });
    const target = await createUser({ email: 'old@example.com' });
    const url = `/api/v1/admin/users/${target.user._id}`;

    let res = await api().patch(url).set(admin.auth).send({ firstName: 'Mona', phone: '01099998888' }).expect(200);
    assert.equal(res.body.user.firstName, 'Mona');
    assert.equal(res.body.user.phone, '+201099998888');

    res = await api().patch(url).set(admin.auth).send({ phone: other.user.phone }).expect(409);
    assert.equal(res.body.error.code, 'PHONE_TAKEN');
    res = await api().patch(url).set(admin.auth).send({ email: 'TAKEN@example.com' }).expect(409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');

    res = await api().patch(url).set(admin.auth).send({ email: '' }).expect(200);
    assert.equal(res.body.user.email, undefined);
    assert.equal((await User.findById(target.user._id)).email, undefined);

    await api().patch(url).set(admin.auth).send({}).expect(422);
  });

  test('setting a password signs the user out everywhere; the new one works', async () => {
    const admin = await createUser({ role: 'admin' });
    const target = await createUser();
    const session = (await login(target.user.phone, 'Passw0rd!x').expect(200)).body;

    await api().put(`/api/v1/admin/users/${target.user._id}/password`).set(admin.auth).send({ password: 'short' }).expect(422);
    await api().put(`/api/v1/admin/users/${target.user._id}/password`).set(admin.auth).send({ password: 'Brand-new-pass' }).expect(200);

    await api().get('/api/v1/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await login(target.user.phone, 'Passw0rd!x').expect(401);
    await login(target.user.phone, 'Brand-new-pass').expect(200);
  });

  test('a disabled account cannot sign in, and its open session stops at once', async () => {
    const admin = await createUser({ role: 'admin' });
    const target = await createUser();
    const session = (await login(target.user.phone, 'Passw0rd!x').expect(200)).body;

    let res = await api().patch(`/api/v1/admin/users/${target.user._id}/status`).set(admin.auth).send({ isActive: false }).expect(200);
    assert.equal(res.body.user.isActive, false);

    res = await api().get('/api/v1/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    res = await login(target.user.phone, 'Passw0rd!x').expect(403);
    assert.equal(res.body.error.code, 'ACCOUNT_DISABLED');

    // a stale token issued before disabling cannot come back either
    await User.updateOne({ _id: target.user._id }, { $set: { tokenVersion: 0 } });
    res = await api().get('/api/v1/me').set(target.auth).expect(401);
    assert.equal(res.body.error.code, 'ACCOUNT_DISABLED');

    const list = await api().get('/api/v1/admin/users?status=disabled').set(admin.auth).expect(200);
    assert.deepEqual(list.body.items.map((u) => u._id), [String(target.user._id)]);

    await api().patch(`/api/v1/admin/users/${target.user._id}/status`).set(admin.auth).send({ isActive: true }).expect(200);
    await login(target.user.phone, 'Passw0rd!x').expect(200);
    const active = await api().get('/api/v1/admin/users?status=active').set(admin.auth).expect(200);
    assert.ok(active.body.items.some((u) => u._id === String(target.user._id)));
  });

  test('admins cannot disable, delete, re-role or reset their own account', async () => {
    const admin = await createUser({ role: 'admin' });
    const me = `/api/v1/admin/users/${admin.user._id}`;
    let res = await api().patch(`${me}/status`).set(admin.auth).send({ isActive: false }).expect(422);
    assert.equal(res.body.error.code, 'CANNOT_DISABLE_SELF');
    res = await api().delete(me).set(admin.auth).expect(422);
    assert.equal(res.body.error.code, 'CANNOT_DELETE_SELF');
    res = await api().put(`${me}/password`).set(admin.auth).send({ password: 'Another-pass1' }).expect(422);
    assert.equal(res.body.error.code, 'CANNOT_RESET_OWN_PASSWORD');
    res = await api().patch(`${me}/role`).set(admin.auth).send({ role: 'user' }).expect(422);
    assert.equal(res.body.error.code, 'CANNOT_CHANGE_OWN_ROLE');
    // editing their own name is fine
    await api().patch(me).set(admin.auth).send({ firstName: 'Khalid' }).expect(200);
  });

  test('delete only works for accounts without history, and cleans up after them', async () => {
    const admin = await createUser({ role: 'admin' });
    const owner = await createUser({ role: 'vendor' });
    const buyer = await createUser();
    const driver = await createUser({ role: 'driver' });
    const fresh = await createUser();
    await Store.create({ name: 'Owned', owner: owner.user._id });
    await Order.create({
      number: 'SM-HISTORY1',
      user: buyer.user._id,
      shipments: [{ store: owner.user._id, storeName: 'X', items: [], itemsTotal: 0, deliveryFee: 0, total: 0, driver: driver.user._id }],
    });
    await Cart.create({ user: fresh.user._id, items: [] });

    const del = (u) => api().delete(`/api/v1/admin/users/${u.user._id}`).set(admin.auth);
    assert.equal((await del(owner).expect(409)).body.error.code, 'USER_OWNS_STORES');
    assert.equal((await del(buyer).expect(409)).body.error.code, 'USER_HAS_ORDERS');
    assert.equal((await del(driver).expect(409)).body.error.code, 'USER_HAS_DELIVERIES');

    await del(fresh).expect(200);
    assert.equal(await User.exists({ _id: fresh.user._id }), null);
    assert.equal(await Cart.exists({ user: fresh.user._id }), null);
    await del(fresh).expect(404);
  });
});
