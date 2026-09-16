const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/refreshToken');
const User = require('../models/user');
const ApiError = require('../utils/ApiError');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
}

function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0 }, secret(), {
    expiresIn: process.env.ACCESS_TOKEN_TTL || '15m',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, secret());
}

function refreshTtlMs() {
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;
  return days * 24 * 60 * 60 * 1000;
}

// Creates a new access + refresh pair. The refresh token is stored hashed.
async function issueTokens(user, meta = {}) {
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  await RefreshToken.create({
    user: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + refreshTtlMs()),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return { accessToken: signAccessToken(user), refreshToken };
}

// Swaps a refresh token for a new pair. Presenting an already-revoked token is
// treated as theft: every token for that user is revoked.
async function rotateRefreshToken(rawToken, meta = {}) {
  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
  if (!doc) throw new ApiError(401, 'REFRESH_INVALID', 'Refresh token is invalid');

  if (doc.revokedAt) {
    await revokeAllForUser(doc.user);
    throw new ApiError(401, 'REFRESH_REUSED', 'Refresh token was already used. Please log in again.');
  }
  if (doc.expiresAt < new Date()) {
    throw new ApiError(401, 'REFRESH_EXPIRED', 'Refresh token has expired');
  }

  const user = await User.findById(doc.user);
  if (!user) throw new ApiError(401, 'REFRESH_INVALID', 'Refresh token is invalid');

  doc.revokedAt = new Date();
  await doc.save();

  const tokens = await issueTokens(user, meta);
  return { user, tokens };
}

async function revokeRefreshToken(rawToken) {
  await RefreshToken.updateOne(
    { tokenHash: sha256(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

async function revokeRefreshTokensForUser(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

// Logs the user out everywhere: refresh tokens are revoked and, by bumping
// tokenVersion, every outstanding access token stops validating too.
async function revokeAllForUser(userId) {
  await revokeRefreshTokensForUser(userId);
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

module.exports = {
  sha256,
  signAccessToken,
  verifyAccessToken,
  issueTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokensForUser,
  revokeAllForUser,
};
