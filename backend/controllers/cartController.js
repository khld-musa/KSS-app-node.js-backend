const Cart = require('../models/cart');
const ApiError = require('../utils/ApiError');
const { loadCart, assertPurchasable, MAX_CART_ITEMS } = require('../services/cart');
const { findUsableCoupon } = require('../services/coupons');
const wishlist = require('../services/wishlist');
const recommendations = require('../services/recommendations');

const isSameLine = (item, productId, variantId) =>
  String(item.product) === String(productId) && String(item.variant) === String(variantId);

async function sendCart(res, cart, user, status = 200) {
  const { view } = await loadCart(cart, user);
  res.status(status).json({ success: true, cart: view });
}

async function findItem(user, itemId) {
  const cart = await Cart.findOne({ user: user._id });
  const item = cart?.items.id(itemId);
  if (!item) throw new ApiError(404, 'CART_ITEM_NOT_FOUND', 'Item not found in your cart');
  return { cart, item };
}

// GET /cart
exports.getCart = async (req, res) => {
  await sendCart(res, await Cart.findOne({ user: req.user._id }), req.user);
};

// POST /cart/items   (adding a size already in the cart increases its quantity)
exports.addItem = async (req, res) => {
  const { product, variant, qty } = req.body;
  const cart = (await Cart.findOne({ user: req.user._id })) ?? new Cart({ user: req.user._id, items: [] });

  const existing = cart.items.find((i) => isSameLine(i, product, variant));
  await assertPurchasable(product, variant, (existing?.qty ?? 0) + qty);

  if (existing) {
    existing.qty += qty;
  } else {
    if (cart.items.length >= MAX_CART_ITEMS) {
      throw new ApiError(422, 'CART_FULL', `Your cart can hold at most ${MAX_CART_ITEMS} different items`);
    }
    cart.items.push({ product, variant, qty });
  }
  await cart.save();

  await sendCart(res, cart, req.user, 201);
};

// PATCH /cart/items/:itemId   (quantity and/or size; switching to a size already in the cart merges them)
exports.updateItem = async (req, res) => {
  const { cart, item } = await findItem(req.user, req.params.itemId);
  const variant = req.body.variant ?? String(item.variant);
  const qty = req.body.qty ?? item.qty;

  const other = cart.items.find((i) => !i._id.equals(item._id) && isSameLine(i, item.product, variant));
  if (other) {
    await assertPurchasable(item.product, variant, other.qty + qty);
    other.qty += qty;
    item.deleteOne();
  } else {
    await assertPurchasable(item.product, variant, qty);
    item.variant = variant;
    item.qty = qty;
  }
  await cart.save();

  await sendCart(res, cart, req.user);
};

// DELETE /cart/items/:itemId
exports.removeItem = async (req, res) => {
  const { cart, item } = await findItem(req.user, req.params.itemId);
  item.deleteOne();
  await cart.save();
  await sendCart(res, cart, req.user);
};

// POST /cart/items/:itemId/move-to-wishlist   ("Remove or move to Wishlist" dialog)
exports.moveToWishlist = async (req, res) => {
  const { cart, item } = await findItem(req.user, req.params.itemId);

  // If the product can't be saved (e.g. it was removed), keep the cart as it is
  await wishlist.add(req.user._id, item.product);
  item.deleteOne();
  await cart.save();

  const { view } = await loadCart(cart, req.user);
  res.json({ success: true, cart: view, wishlistCount: await wishlist.count(req.user._id) });
};

// GET /cart/recommendations   ("Product Matches For You")
exports.getRecommendations = async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  const items = await recommendations.forCart(cart?.items.map((i) => i.product) ?? [], req.validated.query.limit);
  res.json({ success: true, items });
};

// POST /cart/coupon
exports.applyCoupon = async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || !cart.items.length) throw new ApiError(422, 'CART_EMPTY', 'Your cart is empty');

  const { coupon, error } = await findUsableCoupon(req.body.code, req.user._id);
  if (error) throw new ApiError(422, error.code, error.message);

  cart.couponCode = coupon.code;
  const { view } = await loadCart(cart, req.user);
  if (!view.coupon.applied) {
    const { code, message, details } = view.coupon.error;
    throw new ApiError(422, code, message, details);
  }
  await cart.save();

  res.json({ success: true, cart: view });
};

// DELETE /cart/coupon
exports.removeCoupon = async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (cart?.couponCode) {
    cart.couponCode = null;
    await cart.save();
  }
  await sendCart(res, cart, req.user);
};
