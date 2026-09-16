const bcrypt = require('bcryptjs');
const validator = require('validator');
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ROLES = ['user', 'vendor', 'driver', 'admin'];

const addressSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 50 },
    // Who receives the delivery (may differ from the account holder)
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    notes: { type: String, trim: true, maxlength: 300 },
    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: [validator.isEmail, 'Please enter a valid email address'],
    },
    // E.164, e.g. +201234567890
    phone: { type: String, required: true, unique: true },
    phoneVerified: { type: Boolean, default: false },
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date },
    // Bumped on password change / forced logout; access tokens carry it and must match
    tokenVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    termsAcceptedAt: { type: Date },
    role: { type: String, enum: ROLES, default: 'user' },
    addresses: [addressSchema],
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.passwordResetTokenHash;
        delete ret.passwordResetExpiresAt;
        return ret;
      },
    },
  }
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

userSchema.methods.comparePassword = function (plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;

module.exports = User;
