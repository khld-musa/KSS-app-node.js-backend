const mongoose = require('mongoose');
const { Schema } = mongoose;

// Where a banner appears on the Home screen
const PLACEMENTS = ['home_top', 'home_middle'];

// What tapping the banner opens
const TARGET_TYPES = ['none', 'product', 'store', 'category', 'url'];

const bannerSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 100, default: '' },
    image: {
      url: { type: String },
      key: { type: String },
    },
    placement: { type: String, enum: PLACEMENTS, required: true },
    target: {
      type: { type: String, enum: TARGET_TYPES, default: 'none' },
      id: { type: Schema.Types.ObjectId, default: null },
      url: { type: String, default: null },
    },
    // Shows the "Ads" tag
    isAd: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    endsAt: {
      type: Date,
      default: null,
      validate: {
        validator(v) {
          return !v || !this.startsAt || v > this.startsAt;
        },
        message: 'endsAt must be after startsAt',
      },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

bannerSchema.index({ placement: 1, isActive: 1, sortOrder: 1 });

const Banner = mongoose.model('Banner', bannerSchema);
Banner.PLACEMENTS = PLACEMENTS;
Banner.TARGET_TYPES = TARGET_TYPES;

module.exports = Banner;
