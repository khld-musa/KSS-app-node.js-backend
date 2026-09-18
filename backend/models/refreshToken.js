const mongoose = require('mongoose');
const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    // Set when this token was exchanged by /auth/refresh (as opposed to logged out)
    rotatedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'RefreshToken', default: null },
    // user.tokenVersion when issued; a later "log out everywhere" bumps the user's version
    tokenVersion: { type: Number, default: 0 },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

// Clean up expired tokens automatically
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
