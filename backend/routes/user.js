const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/userController');
const s = require('../validation/users');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

const admin = [requireAuth, requireRole('admin')];
const id = validate({ params: s.idParam });

router.get('/admin/users', admin, validate({ query: s.listUsers }), ctrl.listUsers);
router.post('/admin/users', admin, validate({ body: s.createUser }), ctrl.createUser);
router.get('/admin/users/:id', admin, id, ctrl.getUser);
router.patch('/admin/users/:id', admin, validate({ params: s.idParam, body: s.updateUser }), ctrl.updateUser);
router.delete('/admin/users/:id', admin, id, ctrl.deleteUser);
router.patch('/admin/users/:id/role', admin, validate({ params: s.idParam, body: s.updateUserRole }), ctrl.updateUserRole);
router.put('/admin/users/:id/password', admin, validate({ params: s.idParam, body: s.setPassword }), ctrl.setPassword);
router.patch('/admin/users/:id/status', admin, validate({ params: s.idParam, body: s.setStatus }), ctrl.setStatus);

module.exports = router;
