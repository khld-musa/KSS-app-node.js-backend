const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/authController');
const schemas = require('../validation/auth');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');
const { authLimiter, otpLimiter } = require('../middlewares/rateLimit');

router.post('/auth/register', otpLimiter, validate({ body: schemas.register }), ctrl.register);
router.post('/auth/otp/resend', otpLimiter, validate({ body: schemas.otpResend }), ctrl.resendOtp);
router.post('/auth/otp/verify', authLimiter, validate({ body: schemas.otpVerify }), ctrl.verifyOtp);

router.post('/auth/password/forgot', otpLimiter, validate({ body: schemas.forgotPassword }), ctrl.forgotPassword);
router.post('/auth/password/reset', authLimiter, validate({ body: schemas.resetPassword }), ctrl.resetPassword);

router.post('/auth/login', authLimiter, validate({ body: schemas.login }), ctrl.login);
router.post('/auth/refresh', authLimiter, validate({ body: schemas.refresh }), ctrl.refresh);
router.post('/auth/logout', validate({ body: schemas.logout }), ctrl.logout);

router.get('/me', requireAuth, ctrl.getMe);
router.patch('/me', requireAuth, validate({ body: schemas.updateMe }), ctrl.updateMe);
router.put('/me/password', requireAuth, validate({ body: schemas.changePassword }), ctrl.changePassword);

module.exports = router;
