const Product = require('../models/product');
const ApiError = require('../utils/ApiError');
const { priceCart } = require('./pricing');
const { findUsableCoupon } = require('./coupons');

const MAX_QTY_PER_ITEM = 10;
const MAX_CART_ITEMS = 50;

const STORE_FIELDS = 'name logo deliveryFee freeDeliveryThreshold freeDelivery isActive';

// Why a cart line cannot be bought right now (null = it can)
function lineIssue(product, variant, qty) {
  if (!product || !product.isActive || !product.store?.isActive) return 'PRODUCT_UNAVAILABLE';
  if (!variant) return 'VARIANT_UNAVAILABLE';
  if (variant.stock <= 0) return 'OUT_OF_STOCK';
  if (qty > variant.stock) return 'QTY_NOT_AVAILABLE';
  return null;
}

// Loads live product data for a cart and prices it.
// Returns:
//   view   - what GET /cart sends to the app
//   priced - output of priceCart; its lines carry the product/variant documents (used by checkout)
//   coupon - the Coupon document when it is currently applied, else null
async function loadCart(cart, user) {
  const items = cart?.items ?? [];
  const products = await Product.find({ _id: { $in: items.map((i) => i.product) } }).populate('store', STORE_FIELDS);
  const productsById = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const issues = [];
  const rows = [];
  for (const item of items) {
    const product = productsById.get(String(item.product));
    const variant = product?.variants.id(item.variant) ?? null;
    const issue = lineIssue(product, variant, item.qty);

    if (issue) {
      issues.push({ itemId: item._id, code: issue });
    } else {
      lines.push({
        itemId: String(item._id),
        product,
        variant,
        store: product.store,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        qty: item.qty,
      });
    }
    rows.push({ item, product, variant, issue });
  }

  let coupon = null;
  let couponError = null;
  if (cart?.couponCode) {
    ({ coupon, error: couponError } = await findUsableCoupon(cart.couponCode, user._id));
  }

  const priced = priceCart(lines, coupon);
  const pricedLines = new Map(priced.stores.flatMap((g) => g.lines).map((l) => [l.itemId, l]));

  let couponView = null;
  if (cart?.couponCode) {
    const result = priced.coupon;
    const error =
      couponError ??
      (result && !result.applied
        ? { code: result.code, message: result.message, ...(result.details && { details: result.details }) }
        : null);
    couponView = {
      code: cart.couponCode,
      applied: Boolean(result?.applied),
      discount: result?.applied ? result.discount : 0,
      error,
    };
  }

  const view = {
    items: rows.map(({ item, product, variant, issue }) => {
      const line = pricedLines.get(String(item._id));
      return {
        _id: item._id,
        qty: item.qty,
        // upper bound for the quantity picker
        maxQty: variant ? Math.min(Math.max(variant.stock, 0), MAX_QTY_PER_ITEM) : 0,
        issue,
        product: product
          ? {
              _id: product._id,
              name: product.name,
              description: product.description,
              image: product.images[0]?.url ?? null,
              // for the "Select Size" sheet
              variants: product.variants.map((v) => ({
                _id: v._id,
                label: v.label,
                price: v.price,
                compareAtPrice: v.compareAtPrice,
                discountPercent: v.discountPercent,
                inStock: v.inStock,
              })),
            }
          : { _id: item.product },
        store: product?.store ? { _id: product.store._id, name: product.store.name, logo: product.store.logo } : null,
        variant: variant ? { _id: variant._id, label: variant.label } : { _id: item.variant },
        price: variant?.price ?? null,
        compareAtPrice: variant?.compareAtPrice ?? null,
        discountPercent: variant?.discountPercent ?? 0,
        lineOriginal: line?.lineOriginal ?? 0,
        lineTotal: line?.lineTotal ?? 0,
      };
    }),
    stores: priced.stores.map((g) => ({
      store: { _id: g.store._id, name: g.store.name, logo: g.store.logo },
      itemIds: g.lines.map((l) => l.itemId),
      itemsTotal: g.itemsTotal,
      deliveryFee: g.deliveryFee,
      freeDeliveryThreshold: g.store.freeDeliveryThreshold ?? null,
      // "Add EGP X for free delivery" (null = this store has no threshold)
      amountToFreeDelivery: g.amountToFreeDelivery,
      couponDiscount: g.couponDiscount,
      total: g.total,
    })),
    coupon: couponView,
    summary: priced.summary,
    issues,
    canCheckout: lines.length > 0 && issues.length === 0 && !(couponView && !couponView.applied),
  };

  return { view, priced, coupon: priced.coupon?.applied ? coupon : null };
}

// Checks a product / size / quantity before it is put in the cart
async function assertPurchasable(productId, variantId, qty) {
  const product = await Product.findOne({ _id: productId, isActive: true }).populate('store', 'isActive');
  if (!product || !product.store?.isActive) {
    throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  const variant = product.variants.id(variantId);
  if (!variant) throw new ApiError(422, 'VARIANT_NOT_FOUND', 'This size is not available');
  if (variant.stock <= 0) throw new ApiError(409, 'OUT_OF_STOCK', 'This item is out of stock');

  const maxQty = Math.min(variant.stock, MAX_QTY_PER_ITEM);
  if (qty > maxQty) {
    throw new ApiError(409, 'QTY_NOT_AVAILABLE', `You can add at most ${maxQty} of this item`, { maxQty });
  }
  return { product, variant };
}

module.exports = { loadCart, assertPurchasable, MAX_QTY_PER_ITEM, MAX_CART_ITEMS };
