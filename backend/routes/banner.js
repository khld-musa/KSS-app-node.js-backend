const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/bannerController');
const s = require('../validation/home');
const { idParam } = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { singleImage } = require('../middlewares/upload');

const admin = [requireAuth, requireRole('admin')];

router.get('/banners', validate({ query: s.listBanners }), ctrl.listBanners);

router.get('/admin/banners', admin, validate({ query: s.listAdminBanners }), ctrl.listAdminBanners);
router.post('/admin/banners', admin, validate({ body: s.createBanner }), ctrl.createBanner);
router.patch('/admin/banners/:id', admin, validate({ params: idParam, body: s.updateBanner }), ctrl.updateBanner);
router.delete('/admin/banners/:id', admin, validate({ params: idParam }), ctrl.deleteBanner);
router.put('/admin/banners/:id/image', admin, validate({ params: idParam }), singleImage('image'), ctrl.uploadBannerImage);

module.exports = router;
