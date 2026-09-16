const mongoose = require('mongoose');
const { Schema } = mongoose;

// "Previously browsed products": one row per user + product, refreshed on every view.
// Kept in its own collection so the user document (loaded on every request) stays small.
const recentViewSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  viewedAt: { type: Date, required: true },
});

recentViewSchema.index({ user: 1, product: 1 }, { unique: true });
recentViewSchema.index({ user: 1, viewedAt: -1 });

module.exports = mongoose.model('RecentView', recentViewSchema);
