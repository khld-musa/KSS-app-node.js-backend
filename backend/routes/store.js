const express = require('express');
const router = express.Router();

const stores = require('../controllers/storeController');
const products = require('../controllers/productController');
const s = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { singleImage } = require('../middlewares/upload');

const admin = [requireAuth, requireRole('admin')];
const manager = [requireAuth, requireRole('vendor', 'admin')];
const id = validate({ params: s.idParam });

// Public
router.get('/stores', validate({ query: s.listStores }), stores.listStores);
router.get('/stores/:id', id, stores.getStore);
router.get('/stores/:id/products', validate({ params: s.idParam, query: s.listProducts }), products.listStoreProducts);

// Admin
router.post('/admin/stores', admin, validate({ body: s.createStore }), stores.createStore);
router.delete('/admin/stores/:id', admin, id, stores.deleteStore);

// Store owner or admin
router.patch('/stores/:id', manager, validate({ params: s.idParam, body: s.updateStore }), stores.updateStore);
router.put('/stores/:id/logo', manager, id, singleImage('image'), stores.uploadStoreImage('logo'));
router.put('/stores/:id/cover', manager, id, singleImage('image'), stores.uploadStoreImage('cover'));
router.post('/stores/:id/products', manager, validate({ params: s.idParam, body: s.createProduct }), products.createProduct);

module.exports = router;
