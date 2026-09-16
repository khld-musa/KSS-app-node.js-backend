const Banner = require('../models/banner');
const Product = require('../models/product');
const Store = require('../models/store');
const Category = require('../models/category');
const ApiError = require('../utils/ApiError');
const storage = require('../utils/storage');
const { findPage } = require('../utils/pagination');
const { activeBanners } = require('../services/banners');

const TARGET_MODELS = { product: Product, store: Store, category: Category };

async function loadBanner(id) {
  const banner = await Banner.findById(id);
  if (!banner) throw new ApiError(404, 'BANNER_NOT_FOUND', 'Banner not found');
  return banner;
}

// Checks the target exists and converts it to the stored shape
async function resolveTarget(target) {
  const Model = TARGET_MODELS[target.type];
  if (Model && !(await Model.exists({ _id: target.id }))) {
    throw new ApiError(422, 'INVALID_TARGET', `The ${target.type} this banner links to was not found`);
  }
  return { type: target.type, id: target.id ?? null, url: target.url ?? null };
}

// GET /banners?placement=
exports.listBanners = async (req, res) => {
  const banners = await activeBanners(req.validated.query.placement);
  res.json({ success: true, banners });
};

// GET /admin/banners   (all banners, including inactive and scheduled)
exports.listAdminBanners = async (req, res) => {
  const { cursor, limit } = req.validated.query;
  const page = await findPage(Banner, {}, { cursor, limit });
  res.json({ success: true, ...page });
};

// POST /admin/banners   (the image is uploaded separately; banners without one are not shown)
exports.createBanner = async (req, res) => {
  const { target, ...fields } = req.body;
  const banner = await Banner.create({ ...fields, ...(target && { target: await resolveTarget(target) }) });
  res.status(201).json({ success: true, banner });
};

// PATCH /admin/banners/:id
exports.updateBanner = async (req, res) => {
  const banner = await loadBanner(req.params.id);
  const { target, ...fields } = req.body;
  banner.set(fields);
  if (target) banner.target = await resolveTarget(target);
  await banner.save();
  res.json({ success: true, banner });
};

// DELETE /admin/banners/:id
exports.deleteBanner = async (req, res) => {
  const banner = await loadBanner(req.params.id);
  await banner.deleteOne();
  await storage.deleteImage(banner.image?.key);
  res.json({ success: true });
};

// PUT /admin/banners/:id/image
exports.uploadBannerImage = async (req, res) => {
  const banner = await loadBanner(req.params.id);
  const oldKey = banner.image?.key;

  banner.image = await storage.saveImage(req.file.buffer, 'banners');
  await banner.save();
  await storage.deleteImage(oldKey);

  res.json({ success: true, banner });
};
