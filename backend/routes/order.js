const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/orderController');
const s = require('../validation/order');
const { idParam } = require('../validation/catalog');
const validate = require('../middlewares/validate');
const { requireAuth, requireRole } = require('../middlewares/auth');

// Customer
router.post('/orders', requireAuth, validate({ body: s.createOrder }), ctrl.createOrder);
router.get('/orders', requireAuth, validate({ query: s.listOrders }), ctrl.listMyOrders);
router.get('/orders/:id', requireAuth, validate({ params: idParam }), ctrl.getOrder);
router.post('/orders/:id/cancel', requireAuth, validate({ params: idParam }), ctrl.cancelOrder);

// Store owner / driver / admin
router.get(
  '/stores/:id/orders',
  requireAuth,
  requireRole('vendor', 'admin'),
  validate({ params: idParam, query: s.listOrders }),
  ctrl.listStoreOrders
);
router.get('/driver/shipments', requireAuth, requireRole('driver'), validate({ query: s.listOrders }), ctrl.listDriverShipments);
router.patch(
  '/orders/:id/shipments/:shipmentId',
  requireAuth,
  requireRole('vendor', 'driver', 'admin'),
  validate({ params: s.shipmentParams, body: s.updateShipment }),
  ctrl.updateShipment
);

// Admin
router.get('/admin/orders', requireAuth, requireRole('admin'), validate({ query: s.listOrders }), ctrl.listAllOrders);

module.exports = router;
