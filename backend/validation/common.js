const { z } = require('zod');
const { normalizePhone } = require('../utils/phone');

// Building blocks shared by the validation schemas.

const objectId = z.string({ error: 'Required' }).regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Amounts are integers in piastres (EGP 540.00 -> 54000)
const money = z
  .number({ error: 'Must be a number' })
  .int('Amounts must be whole piastres')
  .min(0, 'Cannot be negative');

const text = (max) => z.string().trim().max(max, `Must be at most ${max} characters`);
const requiredText = (max) => text(max).min(1, 'Required');

const nonEmpty = (schema) =>
  schema.refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

// Query params for cursor-paginated lists
const page = {
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

// Accepts local or international format; outputs E.164 (+201234567890)
const phone = z
  .string({ error: 'Phone number is required' })
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Please enter a valid phone number' });
      return z.NEVER;
    }
    return normalized;
  });

const location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Optional "near this point" query params (both lat and lng, or neither)
const nearQuery = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(100).default(25),
};

const withNearCheck = (schema) =>
  schema.refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Send both lat and lng',
    path: ['lat'],
  });

module.exports = { objectId, money, text, requiredText, nonEmpty, page, phone, location, nearQuery, withNearCheck };
