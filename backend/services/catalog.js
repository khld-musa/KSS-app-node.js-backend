const Product = require('../models/product');
const Store = require('../models/store');
const { findPage, encodeOffsetCursor, decodeOffsetCursor } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');

// Card queries shared by product/store lists, Home and search.

const PRODUCT_SORTS = {
  newest: { field: '_id', dir: -1 },
  price_asc: { field: 'minPrice', dir: 1 },
  price_desc: { field: 'minPrice', dir: -1 },
  rating: { field: 'ratingAvg', dir: -1 },
  bestselling: { field: 'soldCount', dir: -1 },
};

// What a product card needs: first image, name, price, old price, discount, rating, store
const PRODUCT_CARD_FIELDS = 'name images store minPrice minPriceCompareAt ratingAvg ratingCount soldCount';

// What a store card needs: logo/cover, name, label, delivery time, free-delivery badge
const STORE_CARD_FIELDS = 'name logo cover categoryLabel deliveryMinutes freeDelivery';

const asProductCards = (query) =>
  query.select(PRODUCT_CARD_FIELDS).slice('images', 1).populate('store', 'name logo');

// query: { q, category, collection, minPrice, maxPrice, sort, cursor, limit }
async function findProductCards(baseFilter, query = {}) {
  const filter = { ...baseFilter, isActive: true };
  if (query.category) filter.category = query.category;
  if (query.collection) filter.collections = query.collection;
  if (query.q) filter.name = { $regex: escapeRegex(query.q), $options: 'i' };
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.minPrice = {};
    if (query.minPrice !== undefined) filter.minPrice.$gte = query.minPrice;
    if (query.maxPrice !== undefined) filter.minPrice.$lte = query.maxPrice;
  }

  return findPage(Product, filter, {
    sort: PRODUCT_SORTS[query.sort || 'newest'],
    cursor: query.cursor,
    limit: query.limit || 20,
    project: asProductCards,
  });
}

// Product cards for the given ids, in the same order; inactive or missing products are skipped.
async function productCardsByIds(ids) {
  const products = await asProductCards(Product.find({ _id: { $in: ids }, isActive: true }));
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

// query: { q, lat, lng, radiusKm, cursor, limit }
// With lat/lng: stores within radiusKm, nearest first, each with distanceKm.
// Without: newest first.
async function findStoreCards(query = {}) {
  const limit = query.limit || 20;
  const filter = { isActive: true };
  if (query.q) filter.name = { $regex: escapeRegex(query.q), $options: 'i' };

  if (query.lat === undefined || query.lng === undefined) {
    return findPage(Store, filter, {
      cursor: query.cursor,
      limit,
      project: (q) => q.select(STORE_CARD_FIELDS),
    });
  }

  const offset = query.cursor ? decodeOffsetCursor(query.cursor) : 0;
  const projection = Object.fromEntries(STORE_CARD_FIELDS.split(' ').map((f) => [f, 1]));
  const rows = await Store.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [query.lng, query.lat] },
        distanceField: 'distance',
        maxDistance: (query.radiusKm || 25) * 1000,
        spherical: true,
        query: filter,
      },
    },
    { $skip: offset },
    { $limit: limit + 1 },
    { $project: { ...projection, distance: 1 } },
  ]);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(({ distance, ...row }) => ({
    ...Store.hydrate(row).toJSON(),
    distanceKm: Math.round(distance / 100) / 10,
  }));
  return { items, nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null };
}

module.exports = {
  PRODUCT_SORTS,
  findProductCards,
  productCardsByIds,
  findStoreCards,
};
