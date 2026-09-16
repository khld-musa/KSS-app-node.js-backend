const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/cartController');
const s = require('../validation/order');
const engagement = require('../validation/engagement');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');

router.get('/cart', requireAuth, ctrl.getCart);
router.post('/cart/items', requireAuth, validate({ body: s.addCartItem }), ctrl.addItem);
router.patch('/cart/items/:itemId', requireAuth, validate({ params: s.cartItemParams, body: s.updateCartItem }), ctrl.updateItem);
router.delete('/cart/items/:itemId', requireAuth, validate({ params: s.cartItemParams }), ctrl.removeItem);
router.post('/cart/items/:itemId/move-to-wishlist', requireAuth, validate({ params: s.cartItemParams }), ctrl.moveToWishlist);
router.get('/cart/recommendations', requireAuth, validate({ query: engagement.cartRecommendations }), ctrl.getRecommendations);
router.post('/cart/coupon', requireAuth, validate({ body: s.applyCoupon }), ctrl.applyCoupon);
router.delete('/cart/coupon', requireAuth, ctrl.removeCoupon);

module.exports = router;
