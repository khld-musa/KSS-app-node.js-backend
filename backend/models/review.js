const mongoose = require('mongoose');
const { Schema } = mongoose;

// A customer's rating of a product they received. One per customer per product.
const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    comment: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, _id: -1 });

module.exports = mongoose.model('Review', reviewSchema);
