const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/userController');
const s = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

const admin = [requireAuth, requireRole('admin')];

router.get('/admin/users', admin, validate({ query: s.listUsers }), ctrl.listUsers);
router.patch('/admin/users/:id/role', admin, validate({ params: s.idParam, body: s.updateUserRole }), ctrl.updateUserRole);

module.exports = router;
