const RecentView = require('../models/recentView');
const { productCardsByIds } = require('./catalog');

const KEEP = 20;

// Moves the product to the front of the user's history and trims it to the latest KEEP.
// Never fails the request that triggered it.
async function recordView(userId, productId) {
  try {
    await RecentView.updateOne(
      { user: userId, product: productId },
      { $set: { viewedAt: new Date() } },
      { upsert: true }
    );
    const stale = await RecentView.find({ user: userId }).sort({ viewedAt: -1 }).skip(KEEP).select('_id');
    if (stale.length) {
      await RecentView.deleteMany({ _id: { $in: stale.map((v) => v._id) } });
    }
  } catch (err) {
    console.error(`[recently-viewed] could not record view: ${err.message}`);
  }
}

// Product cards, most recently viewed first
async function recentProductCards(userId, limit = KEEP) {
  const views = await RecentView.find({ user: userId }).sort({ viewedAt: -1 }).limit(limit).select('product');
  return productCardsByIds(views.map((v) => v.product));
}

module.exports = { recordView, recentProductCards, KEEP };
