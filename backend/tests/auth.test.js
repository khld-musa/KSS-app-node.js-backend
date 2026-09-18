const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { api, conn, sms, connectTestDb, closeTestDb, resetDb, lastOtpFor } = require('./helpers');

const PHONE = '+201234567890';
const PASSWORD = 'Passw0rd!x';
const signup = { firstName: 'Mona', lastName: 'Ali', email: 'mona@example.com', phone: '01234567890', password: PASSWORD, acceptTerms: true };

before(connectTestDb);
after(closeTestDb);
beforeEach(resetDb);

// Registers and verifies a user, returns the login tokens
async function registerAndVerify(overrides = {}) {
  const body = { ...signup, ...overrides };
  await api().post('/api/v1/auth/register').send(body).expect(201);
  const phone = body.phone === signup.phone ? PHONE : body.phone;
  const res = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ phone, purpose: 'signup', code: lastOtpFor(phone) })
    .expect(200);
  return res.body;
}

describe('register + verify', () => {
  test('creates an unverified user, sends a 5-digit code, hides secrets', async () => {
    const res = await api().post('/api/v1/auth/register').send(signup).expect(201);
    assert.equal(res.body.user.phone, PHONE);
    assert.equal(res.body.user.phoneVerified, false);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.otp.expiresInSec, 300);
    assert.equal(res.body.otp.resendAfterSec, 30);
    assert.match(lastOtpFor(PHONE), /^\d{5}$/);
  });

  test('rejects an invalid phone, short password, and unaccepted terms', async () => {
    let res = await api().post('/api/v1/auth/register').send({ ...signup, phone: '12' }).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].field, 'phone');

    res = await api().post('/api/v1/auth/register').send({ ...signup, password: 'short' }).expect(422);
    assert.equal(res.body.error.details[0].field, 'password');

    res = await api().post('/api/v1/auth/register').send({ ...signup, acceptTerms: false }).expect(422);
    assert.equal(res.body.error.details[0].field, 'acceptTerms');
  });

  test('cannot log in before the phone is verified', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    const res = await api().post('/api/v1/auth/login').send({ phone: PHONE, password: PASSWORD }).expect(403);
    assert.equal(res.body.error.code, 'PHONE_NOT_VERIFIED');
  });

  test('verifying with the right code returns tokens and unlocks /me', async () => {
    const body = await registerAndVerify();
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);
    assert.equal(body.user.phoneVerified, true);

    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${body.accessToken}`).expect(200);
    assert.equal(me.body.user.firstName, 'Mona');
  });

  test('a verified phone cannot register again; an unverified one can', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    // re-submit before verifying: allowed, details updated
    const again = await api().post('/api/v1/auth/register').send({ ...signup, firstName: 'Mona2' }).expect(201);
    assert.equal(again.body.user.firstName, 'Mona2');

    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: lastOtpFor(PHONE) }).expect(200);
    const res = await api().post('/api/v1/auth/register').send(signup).expect(409);
    assert.equal(res.body.error.code, 'PHONE_TAKEN');
  });

  test('empty or missing code is rejected (no bypass)', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: '' }).expect(422);
    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup' }).expect(422);
    // and for a phone that never requested a code at all
    const res = await api().post('/api/v1/auth/otp/verify').send({ phone: '+201000000000', purpose: 'signup', code: '12345' }).expect(400);
    assert.equal(res.body.error.code, 'OTP_INVALID');
  });

  test('wrong code counts attempts; after 5 the code is locked', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    const real = lastOtpFor(PHONE);
    const wrong = real === '00000' ? '00001' : '00000';

    for (let i = 0; i < 5; i++) {
      const res = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: wrong }).expect(400);
      assert.equal(res.body.error.code, 'OTP_INVALID');
    }
    // even the right code no longer works
    const res = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: real }).expect(429);
    assert.equal(res.body.error.code, 'OTP_TOO_MANY_ATTEMPTS');
  });

  test('an expired code is rejected', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    await conn.collection('otps').updateOne({ phone: PHONE }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: lastOtpFor(PHONE) }).expect(400);
    assert.equal(res.body.error.code, 'OTP_INVALID');
  });

  test('a code is single-use', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    const code = lastOtpFor(PHONE);
    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code }).expect(200);
    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code }).expect(400);
  });

  test('resend enforces the 30s gap, then sends a new code', async () => {
    await api().post('/api/v1/auth/register').send(signup).expect(201);
    const first = lastOtpFor(PHONE);

    const tooSoon = await api().post('/api/v1/auth/otp/resend').send({ phone: PHONE, purpose: 'signup' }).expect(429);
    assert.equal(tooSoon.body.error.code, 'OTP_RESEND_TOO_SOON');
    assert.ok(tooSoon.body.error.details.retryAfterSec > 0);

    // pretend 30s passed
    await conn.collection('otps').updateOne({ phone: PHONE }, { $set: { lastSentAt: new Date(Date.now() - 31_000) } });
    await api().post('/api/v1/auth/otp/resend').send({ phone: PHONE, purpose: 'signup' }).expect(200);
    assert.equal(sms.outbox.length, 2);
    // old code no longer valid
    if (first !== lastOtpFor(PHONE)) {
      await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: first }).expect(400);
    }
    await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: lastOtpFor(PHONE) }).expect(200);
  });
});

describe('login + sessions', () => {
  test('login works with the cookie too, and rejects wrong passwords', async () => {
    await registerAndVerify();
    await api().post('/api/v1/auth/login').send({ phone: PHONE, password: 'nope-nope' }).expect(401);

    const res = await api().post('/api/v1/auth/login').send({ phone: '01234567890', password: PASSWORD }).expect(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('token='));
    assert.match(cookie, /HttpOnly/);
    await api().get('/api/v1/me').set('Cookie', cookie.split(';')[0]).expect(200);
  });

  test('/me requires a valid token', async () => {
    let res = await api().get('/api/v1/me').expect(401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    res = await api().get('/api/v1/me').set('Authorization', 'Bearer garbage').expect(401);
    assert.equal(res.body.error.code, 'TOKEN_INVALID');
  });

  test('refresh rotates tokens; reusing an old one later revokes the whole session', async () => {
    const { refreshToken } = await registerAndVerify();

    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    assert.notEqual(r1.body.refreshToken, refreshToken);

    // a parallel request refreshing with the same token moments later still works
    const parallel = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    assert.notEqual(parallel.body.refreshToken, r1.body.refreshToken);

    // replaying it after the grace period = theft: everything is revoked
    await conn.collection('refreshtokens').updateMany({}, [{ $set: { rotatedAt: { $cond: [{ $ne: ['$rotatedAt', null] }, new Date(Date.now() - 60_000), null] } } }]);
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    assert.equal(reuse.body.error.code, 'REFRESH_REUSED');
    for (const token of [r1.body.refreshToken, parallel.body.refreshToken]) {
      const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: token }).expect(401);
      assert.equal(res.body.error.code, 'REFRESH_REUSED');
    }
  });

  test('the grace period never outlives a logout or a password change', async () => {
    // logged out: the token it was swapped for is revoked, so the old one is refused
    let { refreshToken } = await registerAndVerify();
    const rotated = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    await api().post('/api/v1/auth/logout').send({ refreshToken: rotated.body.refreshToken }).expect(200);
    let res = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    assert.equal(res.body.error.code, 'REFRESH_REUSED');

    // password changed (logs out everywhere): an old token in its grace period is refused too
    const login = await api().post('/api/v1/auth/login').send({ phone: PHONE, password: PASSWORD }).expect(200);
    refreshToken = login.body.refreshToken;
    const next = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    await api()
      .put('/api/v1/me/password')
      .set('Authorization', `Bearer ${next.body.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!' })
      .expect(200);
    res = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    assert.equal(res.body.error.code, 'REFRESH_REUSED');
  });

  test('logout revokes the refresh token', async () => {
    const { refreshToken, accessToken } = await registerAndVerify();
    await api().post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).send({ refreshToken }).expect(200);
    const res = await api().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    assert.equal(res.body.error.code, 'REFRESH_REUSED');
  });
});

describe('password reset', () => {
  test('full flow: forgot -> verify -> reset; old sessions die', async () => {
    const { accessToken: oldAccess, refreshToken: oldRefresh } = await registerAndVerify();
    sms.outbox.length = 0;

    await api().post('/api/v1/auth/password/forgot').send({ phone: PHONE }).expect(200);
    const verify = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ phone: PHONE, purpose: 'reset', code: lastOtpFor(PHONE) })
      .expect(200);
    assert.ok(verify.body.resetToken);
    assert.equal(verify.body.accessToken, undefined, 'reset verification must not log the user in');

    const NEW = 'N3wPassword!';
    const reset = await api()
      .post('/api/v1/auth/password/reset')
      .send({ resetToken: verify.body.resetToken, password: NEW })
      .expect(200);
    assert.ok(reset.body.accessToken);

    await api().post('/api/v1/auth/login').send({ phone: PHONE, password: PASSWORD }).expect(401);
    await api().post('/api/v1/auth/login').send({ phone: PHONE, password: NEW }).expect(200);

    // pre-reset session is dead on both fronts
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${oldAccess}`).expect(401);
    assert.equal(me.body.error.code, 'TOKEN_REVOKED');
    await api().post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);

    // reset token is single-use
    await api().post('/api/v1/auth/password/reset').send({ resetToken: verify.body.resetToken, password: 'Another1!' }).expect(400);
  });

  test('reset without a verified code is impossible', async () => {
    await registerAndVerify();
    // no forgot/verify step at all
    let res = await api().post('/api/v1/auth/password/reset').send({ resetToken: 'made-up', password: 'Whatever1!' }).expect(400);
    assert.equal(res.body.error.code, 'RESET_TOKEN_INVALID');
    res = await api().post('/api/v1/auth/password/reset').send({ resetToken: '', password: 'Whatever1!' }).expect(422);
    // a signup-purpose code cannot be used for reset
    sms.outbox.length = 0;
    await api().post('/api/v1/auth/password/forgot').send({ phone: PHONE }).expect(200);
    res = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'signup', code: lastOtpFor(PHONE) }).expect(400);
  });

  test('forgot does not reveal whether a number exists', async () => {
    const res = await api().post('/api/v1/auth/password/forgot').send({ phone: '+201000000001' }).expect(200);
    assert.equal(res.body.success, true);
    assert.equal(sms.outbox.length, 0);
  });

  test('an expired reset token is rejected', async () => {
    await registerAndVerify();
    sms.outbox.length = 0;
    await api().post('/api/v1/auth/password/forgot').send({ phone: PHONE }).expect(200);
    const verify = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, purpose: 'reset', code: lastOtpFor(PHONE) }).expect(200);
    await conn.collection('users').updateOne({ phone: PHONE }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });
    await api().post('/api/v1/auth/password/reset').send({ resetToken: verify.body.resetToken, password: 'Whatever1!' }).expect(400);
  });
});

describe('profile', () => {
  test('update name/email and change password', async () => {
    const { accessToken } = await registerAndVerify();
    const auth = (r) => r.set('Authorization', `Bearer ${accessToken}`);

    const upd = await auth(api().patch('/api/v1/me')).send({ firstName: 'Mina', email: 'MINA@Example.com' }).expect(200);
    assert.equal(upd.body.user.firstName, 'Mina');
    assert.equal(upd.body.user.email, 'mina@example.com');

    await auth(api().patch('/api/v1/me')).send({}).expect(422);

    let res = await auth(api().put('/api/v1/me/password')).send({ currentPassword: 'wrong', newPassword: 'N3wPassword!' }).expect(400);
    assert.equal(res.body.error.code, 'WRONG_PASSWORD');

    res = await auth(api().put('/api/v1/me/password')).send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!' }).expect(200);
    assert.ok(res.body.accessToken);
    // old access token is now revoked, new one works
    await auth(api().get('/api/v1/me')).expect(401);
    await api().get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
  });

  test('email must be unique across accounts', async () => {
    await registerAndVerify();
    const res = await api().post('/api/v1/auth/register').send({ ...signup, phone: '01098765432' }).expect(409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });
});

describe('plumbing', () => {
  test('health, 404 and bad JSON are all JSON responses', async () => {
    await api().get('/api/v1/health').expect(200);
    const nf = await api().get('/api/v1/nothing-here').expect(404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    const bad = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{oops').expect(400);
    assert.equal(bad.body.error.code, 'INVALID_JSON');
  });
});
