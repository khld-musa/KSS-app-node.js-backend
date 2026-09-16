// Creates an admin account, or promotes an existing account to admin.
// Needed once to bootstrap: every admin endpoint requires an admin, and signup only creates customers.
//
//   npm run create-admin -- --phone 01234567890 --password 'a-long-password' --first Khalid --last Musa
//
// For an existing account --password is optional (sets a new one and logs out its other sessions),
// and --first/--last are ignored.

const path = require('path');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const User = require('../models/user');
const { normalizePhone } = require('../utils/phone');

const MIN_PASSWORD = 8;

async function createAdmin({ phone, password, firstName, lastName }) {
  const normalized = normalizePhone(phone ?? '');
  if (!normalized) throw new Error('--phone is not a valid phone number');
  if (password !== undefined && password.length < MIN_PASSWORD) {
    throw new Error(`--password must be at least ${MIN_PASSWORD} characters`);
  }

  let user = await User.findOne({ phone: normalized }).select('+passwordHash');
  const created = !user;

  if (created) {
    if (!password) throw new Error('--password is required for a new account');
    if (!firstName || !lastName) throw new Error('--first and --last are required for a new account');
    user = new User({ phone: normalized, firstName, lastName });
  }

  if (password) {
    await user.setPassword(password);
    if (!created) {
      user.passwordChangedAt = new Date();
      user.tokenVersion += 1; // log out sessions that used the old password
    }
  }

  user.role = 'admin';
  user.phoneVerified = true;
  await user.save();

  return { user, created };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', 'config', 'config.env'), quiet: true });

  const { values } = parseArgs({
    options: {
      phone: { type: 'string' },
      password: { type: 'string' },
      first: { type: 'string' },
      last: { type: 'string' },
    },
  });

  if (!process.env.DB_LOCAL_URI) throw new Error('DB_LOCAL_URI is not set (see backend/config/config.env.example)');

  await mongoose.connect(process.env.DB_LOCAL_URI);
  try {
    const { user, created } = await createAdmin({
      phone: values.phone,
      password: values.password,
      firstName: values.first,
      lastName: values.last,
    });
    console.log(`${created ? 'Created' : 'Promoted'} admin: ${user.firstName} ${user.lastName} (${user.phone})`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createAdmin };
