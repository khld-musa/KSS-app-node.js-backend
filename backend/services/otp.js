const crypto = require('crypto');
const Otp = require('../models/otp');
const ApiError = require('../utils/ApiError');
const { sendSms } = require('../utils/sms');
const { sha256 } = require('./tokens');

const OTP_LENGTH = 5;
const TTL_MS = 5 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const meta = () => ({ expiresInSec: TTL_MS / 1000, resendAfterSec: RESEND_GAP_MS / 1000 });

function generateCode() {
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

// Creates (or replaces) the code for phone+purpose and sends it by SMS.
async function issue(phone, purpose) {
  const existing = await Otp.findOne({ phone, purpose });
  if (existing) {
    const sinceLast = Date.now() - existing.lastSentAt.getTime();
    if (sinceLast < RESEND_GAP_MS) {
      const retryAfterSec = Math.ceil((RESEND_GAP_MS - sinceLast) / 1000);
      throw new ApiError(429, 'OTP_RESEND_TOO_SOON', `Please wait ${retryAfterSec}s before requesting a new code`, {
        retryAfterSec,
      });
    }
  }

  const code = generateCode();
  await Otp.findOneAndUpdate(
    { phone, purpose },
    { codeHash: sha256(code), expiresAt: new Date(Date.now() + TTL_MS), attempts: 0, lastSentAt: new Date() },
    { upsert: true }
  );

  await sendSms({ to: phone, text: `Your SudaMarket code is ${code}. It expires in 5 minutes.` });
  return meta();
}

// Checks the code and consumes it on success.
async function verify(phone, purpose, code) {
  const invalid = () => new ApiError(400, 'OTP_INVALID', 'Code is invalid or has expired');

  const otp = await Otp.findOne({ phone, purpose });
  if (!otp || otp.expiresAt < new Date()) throw invalid();

  if (otp.attempts >= MAX_ATTEMPTS) {
    throw new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Please request a new code.');
  }

  const given = Buffer.from(sha256(code));
  const expected = Buffer.from(otp.codeHash);
  if (!crypto.timingSafeEqual(given, expected)) {
    await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw invalid();
  }

  await otp.deleteOne();
}

module.exports = { issue, verify, meta, OTP_LENGTH, MAX_ATTEMPTS };
