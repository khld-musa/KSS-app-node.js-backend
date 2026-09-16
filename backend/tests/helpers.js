// Shared setup for tests. Uses a throwaway database on the local MongoDB.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DB_LOCAL_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/sudamarket_test';
process.env.SMS_TRANSPORT = 'memory';
process.env.UPLOAD_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'sudamarket-uploads-'));
process.env.DEFAULT_COUNTRY = 'EG';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const connectDatabase = require('../config/database');
const sms = require('../utils/sms');
const storage = require('../utils/storage');
const User = require('../models/user');
const { signAccessToken } = require('../services/tokens');

const conn = mongoose.connection;
const api = () => request(app);

async function connectTestDb() {
  await connectDatabase();
  await conn.dropDatabase();
  await mongoose.syncIndexes();
}

async function closeTestDb() {
  await conn.dropDatabase();
  await mongoose.disconnect();
  require('fs').rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
}

// Empties every collection but keeps indexes (unique / geo) in place.
async function resetDb() {
  const collections = await conn.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  sms.outbox.length = 0;
}

// Pull the most recent code sent to a phone number out of the fake SMS outbox
function lastOtpFor(phone) {
  const msg = [...sms.outbox].reverse().find((m) => m.to === phone);
  if (!msg) throw new Error(`no SMS sent to ${phone}`);
  return msg.text.match(/\b\d{5}\b/)[0];
}

let phoneCounter = 0;

// Creates a verified user directly in the database and returns it with an access token.
async function createUser(overrides = {}) {
  phoneCounter += 1;
  const user = new User({
    firstName: 'Test',
    lastName: `User${phoneCounter}`,
    phone: `+2010${String(phoneCounter).padStart(8, '0')}`,
    phoneVerified: true,
    ...overrides,
  });
  await user.setPassword('Passw0rd!x');
  await user.save();
  const token = signAccessToken(user);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

module.exports = { api, conn, sms, storage, connectTestDb, closeTestDb, resetDb, lastOtpFor, createUser };
