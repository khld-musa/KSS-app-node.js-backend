const Product = require('../models/product');
const Review = require('../models/review');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');
const { hasReceived, refreshProductRating, reviewView } = require('../services/reviews');

async function loadActiveProduct(id) {
  const product = await Product.findOne({ _id: id, isActive: true }).select('ratingAvg ratingCount');
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return product;
}

async function loadOwnReview(req) {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
  const isAuthor = review.user.equals(req.user._id);
  return { review, isAuthor };
}

// GET /products/:id/reviews   ("Ratings & Reviews": summary + newest reviews first)
exports.listReviews = async (req, res) => {
  const product = await loadActiveProduct(req.params.id);
  const { cursor, limit } = req.validated.query;

  const page = await findPage(Review, { product: product._id }, {
    cursor,
    limit,
    project: (q) => q.populate('user', 'firstName lastName'),
  });

  res.json({
    success: true,
    summary: { ratingAvg: product.ratingAvg, ratingCount: product.ratingCount },
    items: page.items.map(reviewView),
    nextCursor: page.nextCursor,
  });
};

// GET /products/:id/my-review   (whether to show "Write a review", and the user's review if any)
exports.getMyReview = async (req, res) => {
  const product = await loadActiveProduct(req.params.id);
  const review = await Review.findOne({ product: product._id, user: req.user._id }).populate('user', 'firstName lastName');
  const canReview = !review && (await hasReceived(req.user._id, product._id));
  res.json({ success: true, canReview, review: review ? reviewView(review) : null });
};

// POST /products/:id/reviews
exports.createReview = async (req, res) => {
  const product = await loadActiveProduct(req.params.id);

  if (await Review.exists({ product: product._id, user: req.user._id })) {
    throw new ApiError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product. Edit your review instead.');
  }
  if (!(await hasReceived(req.user._id, product._id))) {
    throw new ApiError(403, 'NOT_PURCHASED', 'You can review a product after it has been delivered to you');
  }

  const review = await Review.create({ ...req.body, product: product._id, user: req.user._id });
  await refreshProductRating(product._id);
  await review.populate('user', 'firstName lastName');

  res.status(201).json({ success: true, review: reviewView(review) });
};

// PATCH /reviews/:id   (author only)
exports.updateReview = async (req, res) => {
  const { review, isAuthor } = await loadOwnReview(req);
  if (!isAuthor) throw new ApiError(403, 'FORBIDDEN', 'You can only edit your own review');

  review.set(req.body);
  await review.save();
  await refreshProductRating(review.product);
  await review.populate('user', 'firstName lastName');

  res.json({ success: true, review: reviewView(review) });
};

// DELETE /reviews/:id   (author or admin)
exports.deleteReview = async (req, res) => {
  const { review, isAuthor } = await loadOwnReview(req);
  if (!isAuthor && req.user.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'You can only delete your own review');
  }

  await review.deleteOne();
  await refreshProductRating(review.product);

  res.json({ success: true });
};
