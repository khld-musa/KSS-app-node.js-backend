const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/couponController');
const s = require('../validation/order');
const { idParam } = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

const admin = [requireAuth, requireRole('admin')];

router.get('/admin/coupons', admin, validate({ query: s.listCoupons }), ctrl.listCoupons);
router.post('/admin/coupons', admin, validate({ body: s.createCoupon }), ctrl.createCoupon);
router.patch('/admin/coupons/:id', admin, validate({ params: idParam, body: s.updateCoupon }), ctrl.updateCoupon);
router.delete('/admin/coupons/:id', admin, validate({ params: idParam }), ctrl.deleteCoupon);

module.exports = router;
