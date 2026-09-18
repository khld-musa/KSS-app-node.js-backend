const Store = require('../models/store');
const Product = require('../models/product');
const User = require('../models/user');
const ApiError = require('../utils/ApiError');
const storage = require('../utils/storage');
const { findStoreCards } = require('../services/catalog');
const { assertCanManageStore } = require('../utils/permissions');

const ADMIN_ONLY_FIELDS = ['owner', 'isActive'];

const toPoint = ({ lat, lng }) => ({ type: 'Point', coordinates: [lng, lat] });

async function loadStore(id) {
  const store = await Store.findById(id);
  if (!store) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  return store;
}

// A store owner must be a vendor (or admin). Plain users are promoted to vendor.
async function resolveOwner(ownerId) {
  const owner = await User.findById(ownerId);
  if (!owner) throw new ApiError(422, 'INVALID_OWNER', 'Owner user not found');
  if (owner.role === 'driver') throw new ApiError(422, 'INVALID_OWNER', 'A driver cannot own a store');
  if (owner.role === 'user') {
    owner.role = 'vendor';
    await owner.save();
  }
  return owner;
}

// GET /stores   (with lat + lng: nearest first, each with distanceKm)
exports.listStores = async (req, res) => {
  const page = await findStoreCards(req.validated.query);
  res.json({ success: true, ...page });
};

// GET /stores/:id
exports.getStore = async (req, res) => {
  const store = await Store.findOne({ _id: req.params.id, isActive: true }).select('-owner');
  if (!store) throw new ApiError(404, 'STORE_NOT_FOUND', 'Store not found');
  res.json({ success: true, store });
};

// POST /admin/stores
exports.createStore = async (req, res) => {
  const { owner: ownerId, location, deliveryMinutes, ...fields } = req.body;
  const owner = await resolveOwner(ownerId);

  const store = await Store.create({
    ...fields,
    owner: owner._id,
    ...(location && { location: toPoint(location) }),
    ...(deliveryMinutes && { deliveryMinutes }),
  });
  res.status(201).json({ success: true, store });
};

// PATCH /stores/:id  (owner or admin)
exports.updateStore = async (req, res) => {
  const store = await loadStore(req.params.id);
  assertCanManageStore(req.user, store);

  if (req.user.role !== 'admin') {
    const blocked = ADMIN_ONLY_FIELDS.filter((f) => req.body[f] !== undefined);
    if (blocked.length) {
      throw new ApiError(403, 'FORBIDDEN_FIELD', `Only an admin can change: ${blocked.join(', ')}`);
    }
  }

  const { owner: ownerId, location, deliveryMinutes, collections, ...fields } = req.body;

  if (ownerId !== undefined) store.owner = (await resolveOwner(ownerId))._id;
  // null removes the location / delivery time
  if (location !== undefined) store.location = location === null ? undefined : toPoint(location);
  if (deliveryMinutes !== undefined) {
    store.deliveryMinutes = deliveryMinutes === null ? { min: undefined, max: undefined } : deliveryMinutes;
  }
  store.set(fields);

  // Collections are replaced as a whole. Existing ones are kept by sending their _id;
  // any collection left out is removed and pulled from this store's products.
  let removedIds = [];
  if (collections !== undefined) {
    const existingIds = store.collections.map((c) => String(c._id));
    const keptIds = collections.filter((c) => c._id).map((c) => String(c._id));

    if (keptIds.some((id) => !existingIds.includes(id))) {
      throw new ApiError(422, 'INVALID_COLLECTION', 'Collection does not belong to this store');
    }
    removedIds = existingIds.filter((id) => !keptIds.includes(id));
    store.collections = collections;
  }

  await store.save();

  if (removedIds.length) {
    await Product.updateMany({ store: store._id }, { $pull: { collections: { $in: removedIds } } });
  }

  res.json({ success: true, store });
};

// DELETE /admin/stores/:id
exports.deleteStore = async (req, res) => {
  const store = await loadStore(req.params.id);
  if (await Product.exists({ store: store._id })) {
    throw new ApiError(409, 'STORE_HAS_PRODUCTS', 'Delete this store’s products first');
  }
  await store.deleteOne();
  await storage.deleteImage(store.logo?.key);
  await storage.deleteImage(store.cover?.key);
  res.json({ success: true });
};

// PUT /stores/:id/logo and PUT /stores/:id/cover
exports.uploadStoreImage = (kind) => async (req, res) => {
  const store = await loadStore(req.params.id);
  assertCanManageStore(req.user, store);

  const oldKey = store[kind]?.key;
  store[kind] = await storage.saveImage(req.file.buffer, `stores/${store._id}`);
  await store.save();
  await storage.deleteImage(oldKey);

  res.json({ success: true, store });
};
