const { z } = require('zod');
const { objectId, text, page } = require('./common');

// Management lists include hidden (isActive: false) items; `status` narrows them.
const status = z.enum(['all', 'active', 'inactive']).default('all');

exports.listManagedProducts = z.object({ q: text(80).optional(), status, ...page });
exports.listAdminStores = z.object({ q: text(80).optional(), status, ...page });
exports.storeOrderParams = z.object({ id: objectId, orderId: objectId });
