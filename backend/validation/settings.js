const { z } = require('zod');
const { nonEmpty, phone } = require('./common');

exports.updateSettings = nonEmpty(
  z.object({
    supportPhone: phone.nullable().optional(),
    supportEmail: z.string().trim().toLowerCase().email('Please enter a valid email address').nullable().optional(),
  })
);
