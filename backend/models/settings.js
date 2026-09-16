const mongoose = require('mongoose');
const validator = require('validator');
const { Schema } = mongoose;

// App-wide settings. There is exactly one document, with key "app".
const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'app' },
    // Shown to customers for help and support
    supportPhone: { type: String, default: null },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      validate: {
        validator: (v) => v == null || validator.isEmail(v),
        message: 'Please enter a valid email address',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        delete ret._id;
        delete ret.key;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('Settings', settingsSchema);
