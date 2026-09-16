const mongoose = require('mongoose');
const { Schema } = mongoose;
const { discountPercent } = require('../utils/money');

const imageSchema = new Schema({
  url: { type: String, required: true },
  key: { type: String },
});

// A purchasable option, e.g. "250 ml". Prices are integers in piastres.
const variantSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 50 },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: {
      type: Number,
      min: 0,
      default: null,
      validate: {
        validator(value) {
          return value == null || value > this.price;
        },
        message: 'compareAtPrice must be greater than price',
      },
    },
    stock: { type: Number, min: 0, default: 0 },
  },
  { id: false, toJSON: { virtuals: true } }
);

variantSchema.virtual('discountPercent').get(function () {
  return discountPercent(this.price, this.compareAtPrice);
});

variantSchema.virtual('inStock').get(function () {
  return this.stock > 0;
});

const attributeSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 50 },
    value: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    // Ids of the owning store's collections
    collections: [{ type: Schema.Types.ObjectId }],
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '' },
    howToUse: { type: String, default: '' },
    deliveryReturns: { type: String, default: '' },
    images: [imageSchema],
    // "Product Details" bullets: Size, Skin Type, Scent, ...
    attributes: [attributeSchema],
    variants: {
      type: [variantSchema],
      validate: [(v) => v.length > 0, 'Add at least one variant'],
    },
    // Copied from the cheapest variant on save. Used for sorting, price filters and product cards.
    minPrice: { type: Number, default: 0 },
    minPriceCompareAt: { type: Number, default: null },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, id: false, toJSON: { virtuals: true, versionKey: false } }
);

productSchema.virtual('discountPercent').get(function () {
  return discountPercent(this.minPrice, this.minPriceCompareAt);
});

productSchema.pre('validate', function () {
  if (!this.variants?.length) return;
  const cheapest = this.variants.reduce((a, b) => (b.price < a.price ? b : a));
  this.minPrice = cheapest.price;
  this.minPriceCompareAt = cheapest.compareAtPrice ?? null;
});

productSchema.index({ store: 1, isActive: 1 });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ minPrice: 1, _id: 1 });
productSchema.index({ ratingAvg: -1, _id: -1 });
productSchema.index({ soldCount: -1, _id: -1 });

module.exports = mongoose.model('Product', productSchema);
