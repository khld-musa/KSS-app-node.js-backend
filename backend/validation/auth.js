const { z } = require('zod');
const { phone } = require('./common');

const password = z
  .string({ error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

const name = z.string({ error: 'Required' }).trim().min(1, 'Required').max(50, 'Too long');

const email = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().toLowerCase().email('Please enter a valid email address').optional()
);

const otpCode = z.string({ error: 'Code is required' }).regex(/^\d{5}$/, 'Code must be 5 digits');
const purpose = z.enum(['signup', 'reset'], { error: 'purpose must be signup or reset' });

exports.register = z.object({
  firstName: name,
  lastName: name,
  email,
  phone,
  password,
  acceptTerms: z.boolean().refine((v) => v === true, 'You must accept the Terms & Privacy Policy'),
});

exports.otpResend = z.object({ phone, purpose });

exports.otpVerify = z.object({ phone, purpose, code: otpCode });

exports.login = z.object({ phone, password: z.string({ error: 'Password is required' }).min(1, 'Password is required') });

exports.forgotPassword = z.object({ phone });

exports.resetPassword = z.object({
  resetToken: z.string({ error: 'resetToken is required' }).min(1, 'resetToken is required'),
  password,
});

exports.refresh = z.object({ refreshToken: z.string().min(1, 'refreshToken is required') });

exports.logout = z.object({ refreshToken: z.string().optional() });

exports.updateMe = z
  .object({ firstName: name.optional(), lastName: name.optional(), email })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

exports.changePassword = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});
