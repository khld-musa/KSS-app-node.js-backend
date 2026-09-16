const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { priceCart } = require('../services/pricing');

const store = (id, overrides = {}) => ({
  _id: id,
  deliveryFee: 3000,
  freeDeliveryThreshold: 112800,
  freeDelivery: false,
  ...overrides,
});

const sum = (values) => values.reduce((a, b) => a + b, 0);

describe('priceCart', () => {
  test('the cart from the design, with the correct math', () => {
    const camli = store('camli');
    const result = priceCart([
      { store: camli, price: 54000, compareAtPrice: 62000, qty: 1 }, // Nayra Sandalwood Dilka
      { store: camli, price: 46000, compareAtPrice: 52000, qty: 1 }, // Nayra Body Butter Refill Bag
    ]);

    // the design labels these -30% and -10%; the real discounts are 13% and 12%
    assert.deepEqual(result.stores[0].lines.map((l) => l.discountPercent), [13, 12]);
    assert.deepEqual(result.summary, {
      itemCount: 2,
      subtotal: 114000, // EGP 1,140
      itemSavings: 14000,
      couponDiscount: 0,
      savings: 14000, // EGP 140
      delivery: 3000,
      total: 103000, // 1,140 - 140 + 30
      currency: 'EGP',
    });
    // "Add EGP 128 for free delivery today"
    assert.equal(result.stores[0].amountToFreeDelivery, 12800);
    assert.equal(result.coupon, null);
  });

  test('reaching the threshold makes delivery free', () => {
    const s = store('a', { freeDeliveryThreshold: 100000 });
    const result = priceCart([{ store: s, price: 50000, qty: 2 }]);
    assert.equal(result.stores[0].deliveryFee, 0);
    assert.equal(result.stores[0].amountToFreeDelivery, 0);
    assert.equal(result.summary.total, 100000);
  });

  test('always-free stores and stores without a threshold', () => {
    const free = store('free', { freeDelivery: true });
    const noThreshold = store('plain', { freeDeliveryThreshold: null, deliveryFee: 2000 });
    const result = priceCart([
      { store: free, price: 1000, qty: 1 },
      { store: noThreshold, price: 1000, qty: 1 },
    ]);
    const [a, b] = result.stores;
    assert.equal(a.deliveryFee, 0);
    assert.equal(b.deliveryFee, 2000);
    assert.equal(b.amountToFreeDelivery, null);
    assert.equal(result.summary.delivery, 2000);
  });

  test('delivery is charged per store', () => {
    const result = priceCart([
      { store: store('a'), price: 10000, qty: 1 },
      { store: store('b', { deliveryFee: 2000 }), price: 10000, qty: 1 },
      { store: store('a'), price: 5000, qty: 2 },
    ]);
    assert.equal(result.stores.length, 2);
    assert.equal(result.stores[0].itemsTotal, 20000);
    assert.equal(result.summary.delivery, 5000);
    assert.equal(result.summary.itemCount, 4);
  });

  test('a price without a real discount counts at its own price', () => {
    const result = priceCart([{ store: store('a'), price: 5000, compareAtPrice: 4000, qty: 1 }]);
    assert.equal(result.stores[0].lines[0].lineOriginal, 5000);
    assert.equal(result.stores[0].lines[0].discountPercent, 0);
    assert.equal(result.summary.itemSavings, 0);
  });

  test('percent coupon is capped by maxDiscount; fixed coupon never exceeds the items', () => {
    const s = store('a', { freeDeliveryThreshold: null });
    const lines = [{ store: s, price: 100000, qty: 1 }];

    let result = priceCart(lines, { type: 'percent', value: 10, maxDiscount: 5000 });
    assert.equal(result.summary.couponDiscount, 5000);
    assert.equal(result.summary.total, 100000 - 5000 + 3000);

    result = priceCart(lines, { type: 'fixed', value: 999999 });
    assert.equal(result.summary.couponDiscount, 100000);
    assert.equal(result.summary.total, 3000);
  });

  test('a store coupon only discounts that store', () => {
    const result = priceCart(
      [
        { store: store('a'), price: 10000, qty: 1 },
        { store: store('b'), price: 10000, qty: 1 },
      ],
      { type: 'percent', value: 50, store: 'b' }
    );
    assert.deepEqual(result.stores.map((g) => g.couponDiscount), [0, 5000]);
    assert.deepEqual(result.coupon, { applied: true, discount: 5000 });

    const none = priceCart([{ store: store('a'), price: 10000, qty: 1 }], { type: 'fixed', value: 100, store: 'b' });
    assert.equal(none.coupon.code, 'COUPON_NOT_APPLICABLE');
    assert.equal(none.summary.couponDiscount, 0);
  });

  test('a cart-wide coupon is split across stores and the parts add up exactly', () => {
    const result = priceCart(
      [
        { store: store('a'), price: 10000, qty: 1 },
        { store: store('b'), price: 20000, qty: 1 },
      ],
      { type: 'fixed', value: 1000 }
    );
    // 333.33 and 666.66 -> 333 and 667 (leftover goes to the larger store)
    assert.deepEqual(result.stores.map((g) => g.couponDiscount), [333, 667]);
    assert.equal(result.summary.total, sum(result.stores.map((g) => g.total)));
  });

  test('minimum subtotal not reached: coupon is not applied and says how much is missing', () => {
    const result = priceCart([{ store: store('a'), price: 30000, qty: 1 }], {
      type: 'fixed',
      value: 5000,
      minSubtotal: 50000,
    });
    assert.equal(result.coupon.applied, false);
    assert.equal(result.coupon.code, 'COUPON_MIN_SUBTOTAL');
    assert.equal(result.coupon.details.amountNeeded, 20000);
    assert.equal(result.summary.couponDiscount, 0);
  });

  test('an empty cart prices to zero', () => {
    const result = priceCart([]);
    assert.deepEqual(result.stores, []);
    assert.equal(result.summary.total, 0);
  });
});
