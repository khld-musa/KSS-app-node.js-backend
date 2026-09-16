const ApiError = require('./ApiError');

// Admins manage every store; a vendor manages only the stores they own.
function canManageStore(user, store) {
  if (user.role === 'admin') return true;
  return user.role === 'vendor' && String(store.owner) === String(user._id);
}

function assertCanManageStore(user, store) {
  if (!canManageStore(user, store)) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot manage this store');
  }
}

module.exports = { canManageStore, assertCanManageStore };
