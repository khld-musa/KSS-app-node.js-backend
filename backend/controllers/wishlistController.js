const WishlistItem = require('../models/wishlistItem');
const wishlist = require('../services/wishlist');
const { findPage } = require('../utils/pagination');
const { productCardsByIds } = require('../services/catalog');

// GET /wishlist   (product cards, most recently saved first; hidden products are skipped)
exports.listWishlist = async (req, res) => {
  const { cursor, limit } = req.validated.query;
  const page = await findPage(WishlistItem, { user: req.user._id }, { cursor, limit });
  const items = await productCardsByIds(page.items.map((row) => row.product));
  res.json({ success: true, items, nextCursor: page.nextCursor });
};

// GET /wishlist/ids   (to fill the heart on any product card, plus the badge count)
exports.listWishlistIds = async (req, res) => {
  const ids = await wishlist.productIds(req.user._id);
  res.json({ success: true, ids, count: ids.length });
};

// POST /wishlist/:productId   (201 when newly saved, 200 when it already was)
exports.addToWishlist = async (req, res) => {
  const added = await wishlist.add(req.user._id, req.params.productId);
  res.status(added ? 201 : 200).json({ success: true, wishlisted: true, count: await wishlist.count(req.user._id) });
};

// DELETE /wishlist/:productId   (removing something not saved is fine too)
exports.removeFromWishlist = async (req, res) => {
  await wishlist.remove(req.user._id, req.params.productId);
  res.json({ success: true, wishlisted: false, count: await wishlist.count(req.user._id) });
};
