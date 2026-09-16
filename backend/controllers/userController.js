const User = require('../models/user');
const Store = require('../models/store');
const ApiError = require('../utils/ApiError');
const { findPage } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');

// GET /admin/users
exports.listUsers = async (req, res) => {
  const { q, role, cursor, limit } = req.validated.query;
  const filter = {};
  if (role) filter.role = role;
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [{ phone: pattern }, { firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }

  const page = await findPage(User, filter, { cursor, limit });
  res.json({ success: true, ...page });
};

// PATCH /admin/users/:id/role
exports.updateUserRole = async (req, res) => {
  const { role } = req.body;

  if (String(req.params.id) === String(req.user._id)) {
    throw new ApiError(422, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  const losesStoreAccess = ['vendor', 'admin'].includes(user.role) && !['vendor', 'admin'].includes(role);
  if (losesStoreAccess && (await Store.exists({ owner: user._id }))) {
    throw new ApiError(409, 'USER_OWNS_STORES', 'Reassign this user’s stores before changing their role');
  }

  user.role = role;
  await user.save();
  res.json({ success: true, user });
};
