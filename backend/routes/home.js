const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/homeController');
const s = require('../validation/home');
const validate = require('../middlewares/validate');
const { requireAuth, optionalAuth } = require('../middlewares/auth');

router.get('/home', optionalAuth, validate({ query: s.home }), ctrl.getHome);
router.get('/search', validate({ query: s.search }), ctrl.search);
router.get('/me/recently-viewed', requireAuth, validate({ query: s.recentlyViewed }), ctrl.getRecentlyViewed);

module.exports = router;
