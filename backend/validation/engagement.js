const { z } = require('zod');
const { objectId, text, nonEmpty, page } = require('./common');

const smallList = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) });

// ---------- wishlist ----------

exports.productParam = z.object({ productId: objectId });
exports.listWishlist = z.object({ ...page });

// ---------- reviews ----------

const reviewShape = {
  rating: z
    .number({ error: 'Choose a rating' })
    .int('Rating must be a whole number of stars')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  comment: text(1000).optional(),
};

exports.createReview = z.object(reviewShape);
exports.updateReview = nonEmpty(z.object(reviewShape).partial());
exports.listReviews = z.object({ ...page });

// ---------- recommendations ----------

exports.moreFromStore = smallList;
exports.cartRecommendations = smallList;
