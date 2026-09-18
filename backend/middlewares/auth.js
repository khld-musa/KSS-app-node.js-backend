const User = require('../models/user');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../services/tokens');

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.token || null;
}

// Accepts `Authorization: Bearer <accessToken>` (mobile) or the `token` cookie (web).
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in to continue');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    throw new ApiError(401, code, 'Session is invalid or has expired');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  if (user.isActive === false) throw new ApiError(401, 'ACCOUNT_DISABLED', 'This account has been disabled');

  // Tokens issued before a password change / forced logout carry an old version
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) {
    throw new ApiError(401, 'TOKEN_REVOKED', 'Please log in again');
  }

  req.user = user;
  next();
}

// For public endpoints that do a little more for logged-in users.
// Sets req.user when a valid token is sent; otherwise continues as a guest (never fails).
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub);
      if (user && user.isActive !== false && (payload.tv || 0) === (user.tokenVersion || 0)) req.user = user;
    } catch {
      // invalid or expired token: treat as a guest
    }
  }
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this');
  }
  next();
};

module.exports = { requireAuth, optionalAuth, requireRole };
