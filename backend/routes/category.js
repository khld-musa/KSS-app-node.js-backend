const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/categoryController');
const s = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { singleImage } = require('../middlewares/upload');

const admin = [requireAuth, requireRole('admin')];

router.get('/categories', ctrl.listCategories);

router.post('/admin/categories', admin, validate({ body: s.createCategory }), ctrl.createCategory);
router.patch('/admin/categories/:id', admin, validate({ params: s.idParam, body: s.updateCategory }), ctrl.updateCategory);
router.delete('/admin/categories/:id', admin, validate({ params: s.idParam }), ctrl.deleteCategory);
router.put('/admin/categories/:id/icon', admin, validate({ params: s.idParam }), singleImage('image'), ctrl.uploadCategoryIcon);

module.exports = router;
