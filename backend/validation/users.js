const { z } = require('zod');
const { objectId, text, page, phone, password, personName, email, nonEmpty } = require('./common');

const ROLES = ['user', 'vendor', 'driver', 'admin'];
const role = z.enum(ROLES, { error: 'Choose a role' });

exports.ROLES = ROLES;
exports.idParam = z.object({ id: objectId });

exports.listUsers = z.object({
  q: text(80).optional(),
  role: role.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  ...page,
});

// An account made by an admin is treated as verified: it can sign in straight away
exports.createUser = z.object({
  firstName: personName,
  lastName: personName,
  phone,
  email,
  password,
  role,
});

exports.updateUser = nonEmpty(
  z.object({
    firstName: personName.optional(),
    lastName: personName.optional(),
    phone: phone.optional(),
    // "" or null removes the email
    email: z
      .preprocess(
        (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
        z.string().trim().toLowerCase().email('Please enter a valid email address').nullable()
      )
      .optional(),
  })
);

exports.updateUserRole = z.object({ role });

exports.setPassword = z.object({ password });

exports.setStatus = z.object({ isActive: z.boolean({ error: 'isActive must be true or false' }) });
