const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/addressController');
const s = require('../validation/order');
const validate = require('../middlewares/validate');
const { requireAuth } = require('../middlewares/auth');

router.get('/me/addresses', requireAuth, ctrl.listAddresses);
router.post('/me/addresses', requireAuth, validate({ body: s.createAddress }), ctrl.addAddress);
router.patch('/me/addresses/:addressId', requireAuth, validate({ params: s.addressParams, body: s.updateAddress }), ctrl.updateAddress);
router.delete('/me/addresses/:addressId', requireAuth, validate({ params: s.addressParams }), ctrl.deleteAddress);

module.exports = router;
