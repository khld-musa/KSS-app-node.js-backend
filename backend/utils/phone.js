const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Returns the number in E.164 (+201234567890) or null if it is not a valid number.
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), process.env.DEFAULT_COUNTRY || 'EG');
  return parsed && parsed.isValid() ? parsed.number : null;
}

module.exports = { normalizePhone };
