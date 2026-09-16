const Category = require('../models/category');
const { activeBanners, groupByPlacement } = require('../services/banners');
const { findProductCards, findStoreCards } = require('../services/catalog');
const { recentProductCards } = require('../services/recentlyViewed');
const wishlist = require('../services/wishlist');

const SECTION_SIZE = 10;
const FEED_PAGE_SIZE = 20;

// GET /home?lat=&lng=
// Everything the Home screen shows, in one call. Works with or without login;
// "Previously browsed" is only filled for logged-in users.
exports.getHome = async (req, res) => {
  const { lat, lng, radiusKm } = req.validated.query;

  const [banners, categories, stores, recentlyViewed, topSelling, feed, wishlistCount] = await Promise.all([
    activeBanners(),
    Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }),
    findStoreCards({ lat, lng, radiusKm, limit: SECTION_SIZE }),
    req.user ? recentProductCards(req.user._id, SECTION_SIZE) : [],
    findProductCards({}, { sort: 'bestselling', limit: SECTION_SIZE }),
    findProductCards({}, { sort: 'newest', limit: FEED_PAGE_SIZE }),
    req.user ? wishlist.count(req.user._id) : null,
  ]);

  res.json({
    success: true,
    // heart badge (null for guests)
    wishlistCount,
    // { home_top: [...], home_middle: [...] }
    banners: groupByPlacement(banners),
    categories,
    // Nearest first when lat/lng are sent (each with distanceKm); newest otherwise.
    // "See All" -> GET /stores with the same lat/lng and this cursor
    storesNearYou: stores,
    previouslyBrowsed: recentlyViewed,
    topSelling: topSelling.items,
    // "Keep Scrolling" -> continue with GET /products?cursor=<nextCursor>
    feed,
  });
};

// GET /search?q=
// First results for both products and stores. "See more" -> GET /products?q= or GET /stores?q=
exports.search = async (req, res) => {
  const { q, limit } = req.validated.query;
  const [products, stores] = await Promise.all([
    findProductCards({}, { q, limit }),
    findStoreCards({ q, limit }),
  ]);
  res.json({ success: true, products, stores });
};

// GET /me/recently-viewed
exports.getRecentlyViewed = async (req, res) => {
  const items = await recentProductCards(req.user._id, req.validated.query.limit);
  res.json({ success: true, items });
};
