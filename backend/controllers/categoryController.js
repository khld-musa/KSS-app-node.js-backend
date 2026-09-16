const Category = require('../models/category');
const Product = require('../models/product');
const ApiError = require('../utils/ApiError');
const storage = require('../utils/storage');
const { escapeRegex } = require('../utils/regex');

async function loadCategory(id) {
  const category = await Category.findById(id);
  if (!category) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  return category;
}

async function assertNameFree(name, exceptId) {
  const filter = { name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await Category.exists(filter)) {
    throw new ApiError(409, 'CATEGORY_EXISTS', 'A category with this name already exists');
  }
}

// GET /categories
exports.listCategories = async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, categories });
};

// POST /admin/categories
exports.createCategory = async (req, res) => {
  await assertNameFree(req.body.name);
  const category = await Category.create(req.body);
  res.status(201).json({ success: true, category });
};

// PATCH /admin/categories/:id
exports.updateCategory = async (req, res) => {
  const category = await loadCategory(req.params.id);
  if (req.body.name !== undefined) await assertNameFree(req.body.name, category._id);
  category.set(req.body);
  await category.save();
  res.json({ success: true, category });
};

// DELETE /admin/categories/:id
exports.deleteCategory = async (req, res) => {
  const category = await loadCategory(req.params.id);
  if (await Product.exists({ category: category._id })) {
    throw new ApiError(409, 'CATEGORY_IN_USE', 'Move or delete the products in this category first');
  }
  await category.deleteOne();
  await storage.deleteImage(category.icon?.key);
  res.json({ success: true });
};

// PUT /admin/categories/:id/icon
exports.uploadCategoryIcon = async (req, res) => {
  const category = await loadCategory(req.params.id);
  const oldKey = category.icon?.key;

  category.icon = await storage.saveImage(req.file.buffer, 'categories');
  await category.save();
  await storage.deleteImage(oldKey);

  res.json({ success: true, category });
};
