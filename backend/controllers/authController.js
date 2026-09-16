const crypto = require('crypto');
const User = require('../models/user');
const ApiError = require('../utils/ApiError');
const otpService = require('../services/otp');
const tokens = require('../services/tokens');

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

const clientMeta = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

// Writes the access token to a cookie for web clients and returns both tokens in the body.
function sendAuth(res, status, user, pair) {
  res.cookie('token', pair.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'PRODUCTION',
    maxAge: 15 * 60 * 1000,
  });
  res.status(status).json({ success: true, user, ...pair });
}

// Sends an OTP, but tolerates the resend gap (the caller still gets the timing info).
async function issueOtpSoftly(phone, purpose) {
  try {
    return await otpService.issue(phone, purpose);
  } catch (err) {
    if (err.code !== 'OTP_RESEND_TOO_SOON') throw err;
    return { ...otpService.meta(), resendAfterSec: err.details.retryAfterSec };
  }
}

// POST /auth/register
exports.register = async (req, res) => {
  const { firstName, lastName, email, phone, password } = req.body;

  let user = await User.findOne({ phone }).select('+passwordHash');
  if (user && user.phoneVerified) {
    throw new ApiError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
  }

  if (email) {
    const emailOwner = await User.findOne({ email, ...(user ? { _id: { $ne: user._id } } : {}) });
    if (emailOwner) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }

  // An unverified signup can be re-submitted; the latest details win.
  if (!user) user = new User({ phone });
  user.set({ firstName, lastName, email, termsAcceptedAt: new Date() });
  await user.setPassword(password);
  await user.save();

  const otp = await issueOtpSoftly(phone, 'signup');
  res.status(201).json({ success: true, user, otp });
};

// POST /auth/otp/resend
exports.resendOtp = async (req, res) => {
  const { phone, purpose } = req.body;
  const user = await User.findOne({ phone });

  if (purpose === 'signup') {
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'No signup found for this phone number');
    if (user.phoneVerified) throw new ApiError(409, 'ALREADY_VERIFIED', 'This phone number is already verified');
    const otp = await otpService.issue(phone, 'signup');
    return res.json({ success: true, otp });
  }

  // reset: never reveal whether the number is registered
  if (user && user.phoneVerified) await otpService.issue(phone, 'reset');
  res.json({ success: true, otp: otpService.meta() });
};

// POST /auth/otp/verify
exports.verifyOtp = async (req, res) => {
  const { phone, purpose, code } = req.body;

  const user = await User.findOne({ phone });
  if (!user) throw new ApiError(400, 'OTP_INVALID', 'Code is invalid or has expired');

  await otpService.verify(phone, purpose, code);

  if (purpose === 'signup') {
    if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }
    const pair = await tokens.issueTokens(user, clientMeta(req));
    return sendAuth(res, 200, user, pair);
  }

  // reset: hand back a short-lived token that is the only way to set a new password
  const resetToken = crypto.randomBytes(32).toString('base64url');
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: tokens.sha256(resetToken),
        passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    }
  );
  res.json({ success: true, resetToken, expiresInSec: RESET_TOKEN_TTL_MS / 1000 });
};

// POST /auth/password/forgot
exports.forgotPassword = async (req, res) => {
  const { phone } = req.body;
  const user = await User.findOne({ phone });
  if (user && user.phoneVerified) await issueOtpSoftly(phone, 'reset');

  res.json({
    success: true,
    message: 'If this number is registered, a code has been sent to it',
    otp: otpService.meta(),
  });
};

// POST /auth/password/reset
exports.resetPassword = async (req, res) => {
  const { resetToken, password } = req.body;

  const user = await User.findOne({
    passwordResetTokenHash: tokens.sha256(resetToken),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) throw new ApiError(400, 'RESET_TOKEN_INVALID', 'Reset link is invalid or has expired');

  await user.setPassword(password);
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1; // every existing access token stops working
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();

  // Log out every device; then log this one in
  await tokens.revokeRefreshTokensForUser(user._id);
  const pair = await tokens.issueTokens(user, clientMeta(req));
  sendAuth(res, 200, user, pair);
};

// POST /auth/login
exports.login = async (req, res) => {
  const { phone, password } = req.body;

  const user = await User.findOne({ phone }).select('+passwordHash');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Phone number or password is incorrect');
  }
  if (!user.phoneVerified) {
    throw new ApiError(403, 'PHONE_NOT_VERIFIED', 'Please verify your phone number first');
  }

  const pair = await tokens.issueTokens(user, clientMeta(req));
  sendAuth(res, 200, user, pair);
};

// POST /auth/refresh
exports.refresh = async (req, res) => {
  const { user, tokens: pair } = await tokens.rotateRefreshToken(req.body.refreshToken, clientMeta(req));
  sendAuth(res, 200, user, pair);
};

// POST /auth/logout
exports.logout = async (req, res) => {
  if (req.body.refreshToken) await tokens.revokeRefreshToken(req.body.refreshToken);
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
};

// GET /me
exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

// PATCH /me
exports.updateMe = async (req, res) => {
  const { firstName, lastName, email } = req.body;

  if (email && email !== req.user.email) {
    const emailOwner = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (emailOwner) throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }

  if (firstName !== undefined) req.user.firstName = firstName;
  if (lastName !== undefined) req.user.lastName = lastName;
  if (email !== undefined) req.user.email = email;
  await req.user.save();

  res.json({ success: true, user: req.user });
};

// PUT /me/password
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.comparePassword(currentPassword))) {
    throw new ApiError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  }

  await user.setPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1; // every existing access token stops working
  await user.save();

  // Other sessions are logged out; this one gets fresh tokens
  await tokens.revokeRefreshTokensForUser(user._id);
  const pair = await tokens.issueTokens(user, clientMeta(req));
  sendAuth(res, 200, user, pair);
};
