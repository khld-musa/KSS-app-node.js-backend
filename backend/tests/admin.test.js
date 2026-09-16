const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, connectTestDb, closeTestDb, resetDb, createUser } = require('./helpers');
const User = require('../models/user');
const { createAdmin } = require('../scripts/createAdmin');

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

describe('settings', () => {
  test('public read, admin update, validated', async () => {
    const admin = await createUser({ role: 'admin' });
    const user = await createUser();

    let res = await api().get('/api/v1/settings').expect(200);
    assert.equal(res.body.settings.supportPhone, null);
    assert.equal(res.body.settings.supportEmail, null);
    assert.equal(res.body.settings._id, undefined);

    res = await api()
      .patch('/api/v1/admin/settings')
      .set(admin.auth)
      .send({ supportPhone: '01234567890', supportEmail: 'Help@SudaMarket.com' })
      .expect(200);
    assert.equal(res.body.settings.supportPhone, '+201234567890');
    assert.equal(res.body.settings.supportEmail, 'help@sudamarket.com');

    res = await api().get('/api/v1/settings').expect(200);
    assert.equal(res.body.settings.supportPhone, '+201234567890');

    await api().patch('/api/v1/admin/settings').set(admin.auth).send({ supportEmail: 'not-an-email' }).expect(422);
    await api().patch('/api/v1/admin/settings').set(admin.auth).send({ supportPhone: '12' }).expect(422);
    await api().patch('/api/v1/admin/settings').set(admin.auth).send({}).expect(422);
    await api().patch('/api/v1/admin/settings').set(user.auth).send({ supportEmail: 'x@y.com' }).expect(403);

    res = await api().patch('/api/v1/admin/settings').set(admin.auth).send({ supportEmail: null }).expect(200);
    assert.equal(res.body.settings.supportEmail, null);
  });

  test('the old /Infos endpoint is gone', async () => {
    await api().get('/api/v1/Infos').expect(404);
  });
});

describe('create-admin script', () => {
  test('creates a new admin who can log in', async () => {
    const { user, created } = await createAdmin({
      phone: '01011112222',
      password: 'Adm1n-password',
      firstName: 'Khalid',
      lastName: 'Musa',
    });
    assert.equal(created, true);
    assert.equal(user.role, 'admin');
    assert.equal(user.phoneVerified, true);

    const login = await api().post('/api/v1/auth/login').send({ phone: '01011112222', password: 'Adm1n-password' }).expect(200);
    await api().get('/api/v1/admin/users').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
  });

  test('promotes an existing account, keeping its password unless a new one is given', async () => {
    const existing = await createUser({ firstName: 'Mona' });

    let { user, created } = await createAdmin({ phone: existing.user.phone });
    assert.equal(created, false);
    assert.equal(user.role, 'admin');
    assert.equal(user.firstName, 'Mona');
    await api().get('/api/v1/admin/users').set(existing.auth).expect(200);

    ({ user } = await createAdmin({ phone: existing.user.phone, password: 'Brand-new-pass' }));
    // the old session is logged out
    await api().get('/api/v1/me').set(existing.auth).expect(401);
    await api().post('/api/v1/auth/login').send({ phone: existing.user.phone, password: 'Brand-new-pass' }).expect(200);
  });

  test('rejects bad input without touching the database', async () => {
    await assert.rejects(createAdmin({ phone: '12', password: 'long-enough' }), /valid phone/);
    await assert.rejects(createAdmin({ phone: '01011112222', password: 'short' }), /at least 8/);
    await assert.rejects(createAdmin({ phone: '01011112222' }), /--password is required/);
    await assert.rejects(createAdmin({ phone: '01011112222', password: 'long-enough' }), /--first and --last/);
    assert.equal(await User.countDocuments(), 0);
  });
});
