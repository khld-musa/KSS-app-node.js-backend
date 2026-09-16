const Banner = require('../models/banner');

// Banners that should be visible right now: active, have an image, and inside their date window.
async function activeBanners(placement) {
  const now = new Date();
  const filter = {
    isActive: true,
    'image.url': { $exists: true, $ne: null },
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  };
  if (placement) filter.placement = placement;
  return Banner.find(filter).sort({ sortOrder: 1, _id: -1 });
}

// { home_top: [...], home_middle: [...] }
function groupByPlacement(banners) {
  const groups = Object.fromEntries(Banner.PLACEMENTS.map((p) => [p, []]));
  for (const banner of banners) groups[banner.placement].push(banner);
  return groups;
}

module.exports = { activeBanners, groupByPlacement };
