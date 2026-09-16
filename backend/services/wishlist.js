const Product = require('../models/product');
const WishlistItem = require('../models/wishlistItem');
const ApiError = require('../utils/ApiError');

const MAX_ITEMS = 500;

const count = (userId) => WishlistItem.countDocuments({ user: userId });

// Saves a product. Saving one that is already saved does nothing.
// Returns true when it was newly added.
async function add(userId, productId) {
  if (!(await Product.exists({ _id: productId, isActive: true }))) {
    throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  if (await WishlistItem.exists({ user: userId, product: productId })) return false;

  if ((await count(userId)) >= MAX_ITEMS) {
    throw new ApiError(422, 'WISHLIST_FULL', `Your wishlist can hold at most ${MAX_ITEMS} products`);
  }
  const res = await WishlistItem.updateOne(
    { user: userId, product: productId },
    { $setOnInsert: { user: userId, product: productId } },
    { upsert: true }
  );
  return res.upsertedCount === 1;
}

async function remove(userId, productId) {
  await WishlistItem.deleteOne({ user: userId, product: productId });
}

async function productIds(userId) {
  const rows = await WishlistItem.find({ user: userId }).sort({ _id: -1 }).limit(MAX_ITEMS).select('product');
  return rows.map((r) => r.product);
}

async function has(userId, productId) {
  return Boolean(await WishlistItem.exists({ user: userId, product: productId }));
}

module.exports = { add, remove, count, productIds, has, MAX_ITEMS };
