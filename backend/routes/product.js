const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/productController');
const s = require('../validation/catalog');
const engagement = require('../validation/engagement');
const validate = require('../middlewares/validate');
const { requireAuth, optionalAuth, requireRole } = require('../middlewares/auth');
const { imageArray } = require('../middlewares/upload');

const manager = [requireAuth, requireRole('vendor', 'admin')];
const id = validate({ params: s.idParam });

// Public
router.get('/products', validate({ query: s.listProducts }), ctrl.listProducts);
// Logged-in views are recorded for "Previously browsed products"
router.get('/products/:id', optionalAuth, id, ctrl.getProduct);
router.get('/products/:id/more-from-store', validate({ params: s.idParam, query: engagement.moreFromStore }), ctrl.getMoreFromStore);

// Store owner or admin (products are created under /stores/:id/products)
router.patch('/products/:id', manager, validate({ params: s.idParam, body: s.updateProduct }), ctrl.updateProduct);
router.delete('/products/:id', manager, id, ctrl.deleteProduct);
router.post('/products/:id/images', manager, id, imageArray('images', 10), ctrl.uploadProductImages);
router.delete('/products/:id/images/:imageId', manager, validate({ params: s.imageParams }), ctrl.deleteProductImage);

module.exports = router;
