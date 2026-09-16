const Product = require('../models/product');
const { findProductCards } = require('./catalog');

// "Explore More From This Brand": the store's other products, best sellers first
async function moreFromStore(product, limit) {
  const page = await findProductCards(
    { store: product.store, _id: { $ne: product._id } },
    { sort: 'bestselling', limit }
  );
  return page.items;
}

// "Product Matches For You": products from the same categories or stores as the cart,
// best sellers first, topped up with overall best sellers. Never repeats cart items.
async function forCart(cartProductIds, limit) {
  const exclude = [...cartProductIds];
  const items = [];

  if (cartProductIds.length) {
    const inCart = await Product.find({ _id: { $in: cartProductIds } }).select('store category');
    const related = await findProductCards(
      {
        _id: { $nin: exclude },
        $or: [
          { category: { $in: inCart.map((p) => p.category) } },
          { store: { $in: inCart.map((p) => p.store) } },
        ],
      },
      { sort: 'bestselling', limit }
    );
    items.push(...related.items);
  }

  if (items.length < limit) {
    const fill = await findProductCards(
      { _id: { $nin: [...exclude, ...items.map((p) => p._id)] } },
      { sort: 'bestselling', limit: limit - items.length }
    );
    items.push(...fill.items);
  }

  return items;
}

module.exports = { moreFromStore, forCart };
