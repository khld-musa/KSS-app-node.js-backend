const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/reviewController');
const s = require('../validation/engagement');
const { idParam } = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');

router.get('/products/:id/reviews', validate({ params: idParam, query: s.listReviews }), ctrl.listReviews);
router.get('/products/:id/my-review', requireAuth, validate({ params: idParam }), ctrl.getMyReview);
router.post('/products/:id/reviews', requireAuth, validate({ params: idParam, body: s.createReview }), ctrl.createReview);

router.patch('/reviews/:id', requireAuth, validate({ params: idParam, body: s.updateReview }), ctrl.updateReview);
router.delete('/reviews/:id', requireAuth, validate({ params: idParam }), ctrl.deleteReview);

module.exports = router;
