const { z } = require('zod');
const { objectId, text, nonEmpty, page, nearQuery, withNearCheck } = require('./common');
const Banner = require('../models/banner');

// ---------- banners ----------

const httpsUrl = z
  .string()
  .trim()
  .url('Invalid link')
  .refine((u) => u.startsWith('https://'), 'Link must start with https://');

const target = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('product'), id: objectId }),
  z.object({ type: z.literal('store'), id: objectId }),
  z.object({ type: z.literal('category'), id: objectId }),
  z.object({ type: z.literal('url'), url: httpsUrl }),
]);

const bannerShape = {
  title: text(100).optional(),
  placement: z.enum(Banner.PLACEMENTS),
  target: target.optional(),
  isAd: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
};

exports.createBanner = z.object(bannerShape);
exports.updateBanner = nonEmpty(z.object(bannerShape).partial());
exports.listBanners = z.object({ placement: z.enum(Banner.PLACEMENTS).optional() });
exports.listAdminBanners = z.object({ ...page });

// ---------- home & search ----------

exports.home = withNearCheck(z.object({ ...nearQuery }));

exports.search = z.object({
  q: text(80).min(1, 'Type something to search'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

exports.recentlyViewed = z.object({ limit: z.coerce.number().int().min(1).max(20).default(20) });
