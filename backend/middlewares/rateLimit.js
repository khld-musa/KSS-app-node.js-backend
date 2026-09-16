const { rateLimit } = require('express-rate-limit');
const ApiError = require('../utils/ApiError');

const base = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, please try again later'));
  },
};

// Login / refresh / password reset attempts per IP
const authLimiter = rateLimit({ ...base, limit: 30 });

// Anything that triggers an SMS, per IP
const otpLimiter = rateLimit({ ...base, limit: 10 });

module.exports = { authLimiter, otpLimiter };
