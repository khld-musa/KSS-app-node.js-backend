const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/wishlistController');
const s = require('../validation/engagement');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');

router.get('/wishlist', requireAuth, validate({ query: s.listWishlist }), ctrl.listWishlist);
router.get('/wishlist/ids', requireAuth, ctrl.listWishlistIds);
router.post('/wishlist/:productId', requireAuth, validate({ params: s.productParam }), ctrl.addToWishlist);
router.delete('/wishlist/:productId', requireAuth, validate({ params: s.productParam }), ctrl.removeFromWishlist);

module.exports = router;
