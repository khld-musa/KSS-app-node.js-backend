const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/manageController');
const s = require('../validation/manage');
const { idParam } = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

const manager = [requireAuth, requireRole('vendor', 'admin')];
const admin = [requireAuth, requireRole('admin')];
const id = validate({ params: idParam });

// Vendor portal (admins may use them for any store)
router.get('/me/stores', manager, ctrl.listMyStores);
router.get('/manage/stores/:id', manager, id, ctrl.getManagedStore);
router.get('/manage/stores/:id/stats', manager, id, ctrl.getStoreStats);
router.get('/manage/stores/:id/products', manager, validate({ params: idParam, query: s.listManagedProducts }), ctrl.listManagedProducts);
router.get('/manage/stores/:id/orders/:orderId', manager, validate({ params: s.storeOrderParams }), ctrl.getStoreOrder);
router.get('/manage/products/:id', manager, id, ctrl.getManagedProduct);
router.get('/drivers', manager, ctrl.listDrivers);

// Admin portal
router.get('/admin/stats', admin, ctrl.getAdminStats);
router.get('/admin/stores', admin, validate({ query: s.listAdminStores }), ctrl.listAdminStores);
router.get('/admin/categories', admin, ctrl.listAdminCategories);

module.exports = router;
