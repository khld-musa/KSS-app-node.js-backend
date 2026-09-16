const ApiError = require('../utils/ApiError');

const MAX_ADDRESSES = 10;

function findAddress(user, id) {
  const address = user.addresses.id(id);
  if (!address) throw new ApiError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  return address;
}

function clearDefault(user) {
  for (const a of user.addresses) a.isDefault = false;
}

// GET /me/addresses
exports.listAddresses = async (req, res) => {
  res.json({ success: true, addresses: req.user.addresses });
};

// POST /me/addresses   (the first address becomes the default)
exports.addAddress = async (req, res) => {
  const user = req.user;
  if (user.addresses.length >= MAX_ADDRESSES) {
    throw new ApiError(422, 'ADDRESS_LIMIT', `You can save at most ${MAX_ADDRESSES} addresses`);
  }

  const makeDefault = req.body.isDefault === true || user.addresses.length === 0;
  if (makeDefault) clearDefault(user);
  user.addresses.push({ ...req.body, isDefault: makeDefault });
  await user.save();

  res.status(201).json({ success: true, address: user.addresses[user.addresses.length - 1], addresses: user.addresses });
};

// PATCH /me/addresses/:addressId
exports.updateAddress = async (req, res) => {
  const user = req.user;
  const address = findAddress(user, req.params.addressId);
  const { isDefault, ...fields } = req.body;

  if (isDefault === false && address.isDefault) {
    throw new ApiError(422, 'DEFAULT_REQUIRED', 'Choose another default address instead');
  }
  if (isDefault === true) {
    clearDefault(user);
    address.isDefault = true;
  }
  address.set(fields);
  await user.save();

  res.json({ success: true, address, addresses: user.addresses });
};

// DELETE /me/addresses/:addressId   (deleting the default promotes the first remaining one)
exports.deleteAddress = async (req, res) => {
  const user = req.user;
  const address = findAddress(user, req.params.addressId);
  const wasDefault = address.isDefault;

  address.deleteOne();
  if (wasDefault && user.addresses.length) user.addresses[0].isDefault = true;
  await user.save();

  res.json({ success: true, addresses: user.addresses });
};
