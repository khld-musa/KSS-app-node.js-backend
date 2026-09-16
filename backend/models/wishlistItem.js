const mongoose = require('mongoose');
const { Schema } = mongoose;

// One row per saved product. Its own collection so the list can be paginated
// and the user document stays small.
const wishlistItemSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

wishlistItemSchema.index({ user: 1, product: 1 }, { unique: true });
wishlistItemSchema.index({ user: 1, _id: -1 });

module.exports = mongoose.model('WishlistItem', wishlistItemSchema);
