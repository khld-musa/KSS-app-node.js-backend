const Product = require('../models/product');
const Store = require('../models/store');
const Category = require('../models/category');
const ApiError = require('../utils/ApiError');
const storage = require('../utils/storage');
const { findProductCards } = require('../services/catalog');
const { recordView } = require('../services/recentlyViewed');
const wishlist = require('../services/wishlist');
const { moreFromStore } = require('../services/recommendations');
const WishlistItem = require('../models/wishlistItem');
const RecentView = require('../models/recentView');
const Review = require('../models/review');
const { assertCanManageStore } = require('../utils/permissions');

const MAX_IMAGES = 10;

const notFound = () => new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

async function assertValidRefs(store, { category, collections }) {
  if (category !== undefined && !(await Category.exists({ _id: category }))) {
    throw new ApiError(422, 'INVALID_CATEGORY', 'Category not found');
  }
  if (collections?.length) {
    const storeCollectionIds = store.collections.map((c) => String(c._id));
    if (collections.some((id) => !storeCollectionIds.includes(String(id)))) {
      throw new ApiError(422, 'INVALID_COLLECTION', 'Collection does not belong to this store');
    }
  }
}

// Loads a product plus its store and checks the current user may manage it
async function loadManagedProduct(req) {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound();
  const store = await Store.findById(product.store);
  if (!store) throw notFound();
  assertCanManageStore(req.user, store);
  return { product, store };
}

// GET /products
exports.listProducts = async (req, res) => {
  const query = req.validated.query;
  const page = await findProductCards(query.store ? { store: query.store } : {}, query);
  res.json({ success: true, ...page });
};

// GET /stores/:id/products
exports.listStoreProducts = async (req, res) => {
  if (!(await Store.exists({ _id: req.params.id, isActive: true }))) {
    throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  }
  const page = await findProductCards({ store: req.params.id }, req.validated.query);
  res.json({ success: true, ...page });
};

// GET /products/:id
exports.getProduct = async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isActive: true })
    .populate('store', 'name logo')
    .populate('category', 'name');
  if (!product) throw notFound();
  let isWishlisted = false;
  if (req.user) {
    await recordView(req.user._id, product._id);
    isWishlisted = await wishlist.has(req.user._id, product._id);
  }
  res.json({ success: true, product: { ...product.toJSON(), isWishlisted } });
};

// GET /products/:id/more-from-store   ("Explore More From This Brand")
exports.getMoreFromStore = async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isActive: true }).select('store');
  if (!product) throw notFound();
  const items = await moreFromStore(product, req.validated.query.limit);
  res.json({ success: true, items });
};

// POST /stores/:id/products  (store owner or admin)
exports.createProduct = async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  assertCanManageStore(req.user, store);
  await assertValidRefs(store, req.body);

  const product = await Product.create({ ...req.body, store: store._id });
  res.status(201).json({ success: true, product });
};

// PATCH /products/:id
exports.updateProduct = async (req, res) => {
  const { product, store } = await loadManagedProduct(req);
  await assertValidRefs(store, req.body);

  // variants are replaced as a whole; send an existing variant's _id to keep it
  product.set(req.body);
  await product.save();
  res.json({ success: true, product });
};

// DELETE /products/:id
exports.deleteProduct = async (req, res) => {
  const { product } = await loadManagedProduct(req);
  await product.deleteOne();
  // Past orders keep their own snapshot; everything else that points at the product goes
  await Promise.all([
    WishlistItem.deleteMany({ product: product._id }),
    RecentView.deleteMany({ product: product._id }),
    Review.deleteMany({ product: product._id }),
    ...product.images.map((img) => storage.deleteImage(img.key)),
  ]);
  res.json({ success: true });
};

// POST /products/:id/images  (multipart, field "images")
exports.uploadProductImages = async (req, res) => {
  const { product } = await loadManagedProduct(req);

  if (product.images.length + req.files.length > MAX_IMAGES) {
    throw new ApiError(422, 'TOO_MANY_IMAGES', `A product can have at most ${MAX_IMAGES} images`);
  }

  for (const file of req.files) {
    product.images.push(await storage.saveImage(file.buffer, `products/${product._id}`));
  }
  await product.save();

  res.status(201).json({ success: true, images: product.images });
};

// DELETE /products/:id/images/:imageId
exports.deleteProductImage = async (req, res) => {
  const { product } = await loadManagedProduct(req);

  const image = product.images.id(req.params.imageId);
  if (!image) throw new ApiError(404, 'IMAGE_NOT_FOUND', 'Image not found');

  const { key } = image;
  image.deleteOne();
  await product.save();
  await storage.deleteImage(key);

  res.json({ success: true, images: product.images });
};
