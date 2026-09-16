// All amounts are integers in piastres (1 EGP = 100 piastres).

// Percentage off, rounded to the nearest whole percent. 0 when there is no real discount.
// e.g. price 54000, compareAtPrice 62000 -> 13
function discountPercent(price, compareAtPrice) {
  if (compareAtPrice == null || compareAtPrice <= price) return 0;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

module.exports = { discountPercent };
