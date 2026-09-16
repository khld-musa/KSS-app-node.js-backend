const mongoose = require('mongoose');
const { Schema } = mongoose;

const imageFields = {
  url: { type: String },
  key: { type: String },
};

// GeoJSON point. Stored as [lng, lat]; the API speaks { lat, lng }.
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

// In-store product groups shown as chips on the brand screen (Best Sellers, Body Care, ...)
const collectionSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  icon: { type: String, default: '' },
});

const storeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    description: { type: String, default: '' },
    // Short label under the store name on cards, e.g. "skin care"
    categoryLabel: { type: String, default: '' },
    address: { type: String, default: '' },
    logo: imageFields,
    cover: imageFields,
    location: { type: pointSchema, default: undefined },
    deliveryMinutes: {
      min: { type: Number, min: 0 },
      max: { type: Number, min: 0 },
    },
    // Piastres. Delivery is charged per store.
    deliveryFee: { type: Number, min: 0, default: 0 },
    // Piastres. Orders from this store at or above this subtotal ship free. null = no threshold.
    freeDeliveryThreshold: { type: Number, min: 0, default: null },
    // Always free, regardless of subtotal
    freeDelivery: { type: Boolean, default: false },
    collections: [collectionSchema],
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        if (ret.location?.coordinates) {
          const [lng, lat] = ret.location.coordinates;
          ret.location = { lat, lng };
        }
        return ret;
      },
    },
  }
);

storeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Store', storeSchema);
