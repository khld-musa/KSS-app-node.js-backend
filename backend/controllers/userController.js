const User = require('../models/user');
const Store = require('../models/store');
const Order = require('../models/order');
const Cart = require('../models/cart');
const Otp = require('../models/otp');
const RefreshToken = require('../models/refreshToken');
const RecentView = require('../models/recentView');
const WishlistItem = require('../models/wishlistItem');
const Review = require('../models/review');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { revokeAllForUser } = require('../services/tokens');

// Admin management of user accounts. Admins cannot disable, delete or reset the
// password of their own account here, so they can never lock themselves out.

const isSelf = (req) => String(req.params.id) === String(req.user._id);

async function loadUser(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

async function assertUnique({ phone, email }, exceptId) {
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (phone && (await User.exists({ phone, ...others }))) {
    throw new ApiError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
  }
  if (email && (await User.exists({ email, ...others }))) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }
}

// GET /admin/users?q=&role=&status=
exports.listUsers = async (req, res) => {
  const { q, role, status, cursor, limit } = req.validated.query;
  const filter = {};
  if (role) filter.role = role;
  if (status === 'disabled') filter.isActive = false;
  if (status === 'active') filter.isActive = { $ne: false };
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [{ phone: pattern }, { firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }

  const page = await findPage(User, filter, { cursor, limit });
  res.json({ success: true, ...page });
};

// GET /admin/users/:id   (with the stores they own and how many orders they placed)
exports.getUser = async (req, res) => {
  const user = await loadUser(req.params.id);
  const [stores, orderCount, deliveryCount] = await Promise.all([
    Store.find({ owner: user._id }).select('name isActive logo').sort({ createdAt: 1 }),
    Order.countDocuments({ user: user._id }),
    Order.countDocuments({ 'shipments.driver': user._id }),
  ]);
  res.json({ success: true, user, stores, orderCount, deliveryCount });
};

// POST /admin/users
exports.createUser = async (req, res) => {
  const { firstName, lastName, phone, email, password, role } = req.body;
  await assertUnique({ phone, email });

  const user = new User({ firstName, lastName, phone, email, role, phoneVerified: true });
  await user.setPassword(password);
  await user.save();

  res.status(201).json({ success: true, user });
};

// PATCH /admin/users/:id   (name, phone, email)
exports.updateUser = async (req, res) => {
  const user = await loadUser(req.params.id);
  const { firstName, lastName, phone, email } = req.body;
  await assertUnique({ phone, email: email || undefined }, user._id);

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (phone !== undefined && phone !== user.phone) {
    user.phone = phone;
    // the admin vouches for the number they typed
    user.phoneVerified = true;
  }
  if (email !== undefined) user.email = email || undefined;
  await user.save();

  res.json({ success: true, user });
};

// PATCH /admin/users/:id/role
exports.updateUserRole = async (req, res) => {
  const { role } = req.body;
  if (isSelf(req)) {
    throw new ApiError(422, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role');
  }

  const user = await loadUser(req.params.id);
  const losesStoreAccess = ['vendor', 'admin'].includes(user.role) && !['vendor', 'admin'].includes(role);
  if (losesStoreAccess && (await Store.exists({ owner: user._id }))) {
    throw new ApiError(409, 'USER_OWNS_STORES', 'Reassign this user’s stores before changing their role');
  }

  user.role = role;
  await user.save();
  res.json({ success: true, user });
};

// PUT /admin/users/:id/password   (sets a new password and signs them out everywhere)
exports.setPassword = async (req, res) => {
  if (isSelf(req)) {
    throw new ApiError(422, 'CANNOT_RESET_OWN_PASSWORD', 'Change your own password from your account instead');
  }
  const user = await User.findById(req.params.id).select('+passwordHash');
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  await user.setPassword(req.body.password);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllForUser(user._id);

  res.json({ success: true });
};

// PATCH /admin/users/:id/status   { isActive }
exports.setStatus = async (req, res) => {
  const { isActive } = req.body;
  if (isSelf(req)) {
    throw new ApiError(422, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account');
  }

  const user = await loadUser(req.params.id);
  user.isActive = isActive;
  await user.save();
  // a disabled account is signed out everywhere, right away
  if (!isActive) await revokeAllForUser(user._id);

  res.json({ success: true, user: await User.findById(user._id) });
};

// DELETE /admin/users/:id
// Only for accounts with no history; anyone with orders, deliveries or stores is disabled instead.
exports.deleteUser = async (req, res) => {
  if (isSelf(req)) {
    throw new ApiError(422, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }
  const user = await loadUser(req.params.id);

  if (await Store.exists({ owner: user._id })) {
    throw new ApiError(409, 'USER_OWNS_STORES', 'This user owns stores. Reassign or delete them first, or disable the account.');
  }
  if (await Order.exists({ user: user._id })) {
    throw new ApiError(409, 'USER_HAS_ORDERS', 'This user has placed orders, so the account is kept. Disable it instead.');
  }
  if (await Order.exists({ 'shipments.driver': user._id })) {
    throw new ApiError(409, 'USER_HAS_DELIVERIES', 'This driver has deliveries on record. Disable the account instead.');
  }

  await Promise.all([
    Cart.deleteMany({ user: user._id }),
    WishlistItem.deleteMany({ user: user._id }),
    RecentView.deleteMany({ user: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
    Review.deleteMany({ user: user._id }),
    Otp.deleteMany({ phone: user.phone }),
  ]);
  await user.deleteOne();

  res.json({ success: true });
};
