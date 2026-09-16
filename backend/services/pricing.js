const { discountPercent } = require('../utils/money');

// Pure price calculation for a cart or an order being placed. No database access.
// All amounts are integers in piastres. Prices include VAT, so VAT is never added on top.
//
// lines:  [{ store: { _id, deliveryFee, freeDeliveryThreshold, freeDelivery }, price, compareAtPrice, qty, ...extra }]
//         (extra fields are passed through untouched)
// coupon: { type: 'percent' | 'fixed', value, minSubtotal, maxDiscount, store } or null
//
// Rules:
//   lineOriginal  = (compareAtPrice if it is a real discount, else price) × qty
//   lineTotal     = price × qty
//   per store:    itemsTotal = Σ lineTotal
//                 deliveryFee = 0 if the store always ships free or itemsTotal ≥ its threshold
//                 total = itemsTotal − couponDiscount + deliveryFee
//   summary:      subtotal = Σ lineOriginal            ("Subtotal")
//                 savings  = (subtotal − Σ lineTotal) + couponDiscount   ("Saving & Discounts")
//                 total    = subtotal − savings + delivery               ("Total (VAT Included)")

const sum = (values) => values.reduce((a, b) => a + b, 0);

function couponAmount(coupon, base) {
  let amount = coupon.type === 'percent' ? Math.floor((base * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscount != null) amount = Math.min(amount, coupon.maxDiscount);
  return Math.min(amount, base);
}

// Splits `amount` across store groups in proportion to their itemsTotal.
// Rounding leftovers go to the largest group so the parts always add up exactly.
function allocate(groups, amount) {
  const base = sum(groups.map((g) => g.itemsTotal));
  for (const g of groups) g.couponDiscount = Math.floor((amount * g.itemsTotal) / base);
  const largest = groups.reduce((a, b) => (b.itemsTotal > a.itemsTotal ? b : a));
  largest.couponDiscount += amount - sum(groups.map((g) => g.couponDiscount));
}

function delivery(store, itemsTotal) {
  const threshold = store.freeDeliveryThreshold ?? null;
  if (store.freeDelivery || (threshold !== null && itemsTotal >= threshold)) {
    return { deliveryFee: 0, amountToFreeDelivery: 0 };
  }
  return {
    deliveryFee: store.deliveryFee || 0,
    // null = this store has no free-delivery threshold
    amountToFreeDelivery: threshold === null ? null : threshold - itemsTotal,
  };
}

function priceCart(lines, coupon = null) {
  const groups = new Map();
  for (const line of lines) {
    const key = String(line.store._id);
    if (!groups.has(key)) {
      groups.set(key, { store: line.store, lines: [], itemsTotal: 0, originalTotal: 0, couponDiscount: 0 });
    }
    const group = groups.get(key);
    const unitOriginal = line.compareAtPrice != null && line.compareAtPrice > line.price ? line.compareAtPrice : line.price;
    const priced = {
      ...line,
      discountPercent: discountPercent(line.price, line.compareAtPrice),
      lineOriginal: unitOriginal * line.qty,
      lineTotal: line.price * line.qty,
    };
    group.lines.push(priced);
    group.itemsTotal += priced.lineTotal;
    group.originalTotal += priced.lineOriginal;
  }
  const stores = [...groups.values()];

  let couponResult = null;
  if (coupon) {
    const eligible = coupon.store ? stores.filter((g) => String(g.store._id) === String(coupon.store)) : stores;
    const base = sum(eligible.map((g) => g.itemsTotal));
    if (base === 0) {
      couponResult = {
        applied: false,
        code: 'COUPON_NOT_APPLICABLE',
        message: 'This coupon does not apply to the items in your cart',
      };
    } else if (base < (coupon.minSubtotal || 0)) {
      couponResult = {
        applied: false,
        code: 'COUPON_MIN_SUBTOTAL',
        message: 'Add more items to use this coupon',
        details: { amountNeeded: coupon.minSubtotal - base },
      };
    } else {
      const amount = couponAmount(coupon, base);
      if (amount > 0) allocate(eligible, amount);
      couponResult = { applied: true, discount: amount };
    }
  }

  for (const g of stores) {
    Object.assign(g, delivery(g.store, g.itemsTotal));
    g.total = g.itemsTotal - g.couponDiscount + g.deliveryFee;
  }

  const subtotal = sum(stores.map((g) => g.originalTotal));
  const itemSavings = subtotal - sum(stores.map((g) => g.itemsTotal));
  const couponDiscount = sum(stores.map((g) => g.couponDiscount));
  const savings = itemSavings + couponDiscount;
  const deliveryTotal = sum(stores.map((g) => g.deliveryFee));

  return {
    stores,
    coupon: couponResult,
    summary: {
      itemCount: sum(lines.map((l) => l.qty)),
      subtotal,
      itemSavings,
      couponDiscount,
      savings,
      delivery: deliveryTotal,
      total: subtotal - savings + deliveryTotal,
      currency: 'EGP',
    },
  };
}

module.exports = { priceCart };
