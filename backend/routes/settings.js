const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/settingsController');
const s = require('../validation/settings');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.get('/settings', ctrl.getSettings);
router.patch('/admin/settings', requireAuth, requireRole('admin'), validate({ body: s.updateSettings }), ctrl.updateSettings);

module.exports = router;
