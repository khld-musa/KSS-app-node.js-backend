const mongoose = require('mongoose');
const Order = require('../models/order');
const Product = require('../models/product');
const Review = require('../models/review');

// A customer may review a product once an order containing it has been delivered to them.
async function hasReceived(userId, productId) {
  return Boolean(
    await Order.exists({
      user: userId,
      shipments: { $elemMatch: { status: 'delivered', 'items.product': productId } },
    })
  );
}

// Recomputes the product's average (one decimal) and count from its reviews.
async function refreshProductRating(productId) {
  const [stats] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: productId },
    {
      ratingAvg: stats ? Math.round(stats.avg * 10) / 10 : 0,
      ratingCount: stats ? stats.count : 0,
    }
  );
}

// What the app shows for a review: no user id, just the author's name
function reviewView(review) {
  const { user, ...rest } = review.toJSON();
  return {
    ...rest,
    author: review.user?.firstName
      ? { firstName: review.user.firstName, lastName: review.user.lastName }
      : null,
  };
}

module.exports = { hasReceived, refreshProductRating, reviewView };
