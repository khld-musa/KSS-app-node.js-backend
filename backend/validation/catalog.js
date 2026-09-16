const { z } = require('zod');
const { objectId, money, text, requiredText, nonEmpty, page, location, nearQuery, withNearCheck } = require('./common');

exports.idParam = z.object({ id: objectId });
exports.imageParams = z.object({ id: objectId, imageId: objectId });

// ---------- categories ----------

const categoryShape = {
  name: requiredText(60),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
};

exports.createCategory = z.object(categoryShape);
exports.updateCategory = nonEmpty(z.object(categoryShape).partial());

// ---------- stores ----------

const storeCollection = z.object({
  _id: objectId.optional(),
  name: requiredText(40),
  icon: text(16).optional(),
});

const storeShape = {
  name: requiredText(80),
  owner: objectId,
  description: text(1000).optional(),
  categoryLabel: text(60).optional(),
  address: text(200).optional(),
  location: location.optional(),
  deliveryMinutes: z
    .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
    .refine((v) => v.min <= v.max, { message: 'min must not be greater than max', path: ['min'] })
    .optional(),
  deliveryFee: money.optional(),
  freeDeliveryThreshold: money.nullable().optional(),
  freeDelivery: z.boolean().optional(),
  collections: z.array(storeCollection).max(20).optional(),
  isActive: z.boolean().optional(),
};

exports.createStore = z.object(storeShape);
exports.updateStore = nonEmpty(z.object(storeShape).partial());

// With lat + lng, stores within radiusKm come back nearest first
exports.listStores = withNearCheck(z.object({ q: text(80).optional(), ...nearQuery, ...page }));

// ---------- products ----------

const variant = z
  .object({
    _id: objectId.optional(),
    label: requiredText(50),
    price: money,
    compareAtPrice: money.nullable().optional(),
    stock: z.number().int().min(0).optional(),
  })
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice > v.price, {
    message: 'compareAtPrice must be greater than price',
    path: ['compareAtPrice'],
  });

const attribute = z.object({ label: requiredText(50), value: requiredText(1000) });

const productShape = {
  name: requiredText(120),
  description: text(5000).optional(),
  howToUse: text(5000).optional(),
  deliveryReturns: text(5000).optional(),
  category: objectId,
  collections: z.array(objectId).max(20).optional(),
  attributes: z.array(attribute).max(30).optional(),
  variants: z
    .array(variant)
    .min(1, 'Add at least one variant')
    .max(20)
    .refine(
      (vs) => new Set(vs.map((v) => v.label.toLowerCase())).size === vs.length,
      'Variant labels must be unique'
    ),
  isActive: z.boolean().optional(),
};

exports.createProduct = z.object(productShape);
exports.updateProduct = nonEmpty(z.object(productShape).partial());

exports.PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'rating', 'bestselling'];

exports.listProducts = z
  .object({
    q: text(80).optional(),
    category: objectId.optional(),
    store: objectId.optional(),
    collection: objectId.optional(),
    sort: z.enum(exports.PRODUCT_SORTS).default('newest'),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    ...page,
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    message: 'minPrice must not be greater than maxPrice',
    path: ['minPrice'],
  });

// ---------- admin users ----------

const ROLES = ['user', 'vendor', 'driver', 'admin'];

exports.listUsers = z.object({ q: text(80).optional(), role: z.enum(ROLES).optional(), ...page });
exports.updateUserRole = z.object({ role: z.enum(ROLES) });
