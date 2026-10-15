'use strict';

const express = require('express');
const {
  getPublicOrderById,
  getOrderById,
  confirmOrder,
  updateOrderUtr,
  isValidPaymentMode,
  DEFAULT_PAYMENT_MODE,
} = require('../db/database');
const { sendOrderConfirmation } = require('../services/email');
const {
  normalizePincode,
  calculateDelivery,
} = require('../services/deliveryCalculator');
const { getCourierEstimate } = require('../services/courierService');

const router = express.Router();

function buildTrackerUrl(req, orderId) {
  const configuredBase = process.env.SNKB_PUBLIC_BASE_URL;
  if (configuredBase && configuredBase.trim()) {
    return `${configuredBase.replace(/\/+$/, '')}/track/${orderId}`;
  }
  const host = req.get('host') || 'localhost:3000';
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${proto}://${host}/track/${orderId}`;
}

/**
 * POST /api/orders/confirm
 *
 * Confirms a pending quote by attaching customer contact details, color choice,
 * and optional production notes. Accepts an optional delivery `pincode`: when
 * present, the server recomputes the courier charge from the stored order
 * weight/dimensions (never trusting client-supplied money) and settles a
 * grand total. Then triggers a customer confirmation email via Resend
 * (rate-limit tolerant).
 */
router.post('/confirm', async (req, res, next) => {
  try {
    const body = req.body || {};
    const orderId = body.orderId ?? body.order_id;
    const customerName = body.customerName ?? body.customer_name;
    const email = body.email ?? body.customer_email;
    const notes = body.notes ?? body.customer_notes;
    const color = body.color ?? body.color_choice ?? 'Concrete Grey';
    const pincode = body.pincode ?? body.delivery_pincode ?? body.pin_code ?? null;
    const paymentMode = body.paymentMode ?? body.payment_mode ?? DEFAULT_PAYMENT_MODE;
    const paymentUtr = body.paymentUtr ?? body.payment_utr ?? body.utr ?? null;
    const material = body.material ?? body.materialType ?? null;
    const layerHeightMm = body.layerHeightMm ?? body.layer_height ?? body.layerHeight ?? null;
    const supportsEnabled = body.supportsEnabled ?? body.supports_enabled ?? body.supports ?? null;
    const partWeightGrams = body.partWeightGrams ?? body.part_weight_grams ?? body.partWeightG ?? null;
    const supportWeightGrams = body.supportWeightGrams ?? body.support_weight_grams ?? body.supportWeightG ?? null;
    const totalWeightGrams = body.totalWeightGrams ?? body.total_weight_grams ?? body.totalWeightG ?? null;
    const dimensionsMm = body.dimensionsMm ?? body.dimensions_mm ?? body.dimensions ?? null;

    const numericId = Number(orderId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_order_id',
        message: 'A valid orderId is required to confirm an order.',
      });
    }

    if (!customerName || !String(customerName).trim()) {
      return res.status(400).json({
        success: false,
        error: 'missing_customer_name',
        message: 'Customer name is required.',
      });
    }

    if (!email || !String(email).trim() || !String(email).includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'invalid_email',
        message: 'A valid email address is required.',
      });
    }

    if (!isValidPaymentMode(paymentMode)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_payment_mode',
        message: 'Payment mode must be Prepaid or COD.',
      });
    }

    // Optional delivery settlement, computed server-side from stored metrics.
    let delivery = null;
    if (pincode !== null && pincode !== undefined && String(pincode).trim() !== '') {
      const pin = normalizePincode(pincode);
      if (!pin) {
        return res.status(400).json({
          success: false,
          error: 'invalid_pincode',
          message: 'Delivery pincode must be a 6-digit Indian PIN code.',
        });
      }
      const stored = await getOrderById(numericId);
      if (!stored) {
        return res.status(404).json({
          success: false,
          error: 'not_found',
          message: `Order #${orderId} was not found.`,
        });
      }
      const courierInfo = await getCourierEstimate({
        deliveryPin: pin,
        weightG: stored.weightG,
      });
      const computed = calculateDelivery({
        weightG: stored.weightG,
        dimensionsMm: stored.dimensions,
        pincode: pin,
        orderValue: stored.quotedPrice,
        rawCourierCost: courierInfo?.rawCost || null,
      });
      delivery = { pincode: computed.pincode, zone: computed.zone, charge: computed.deliveryCharge };
    }

    const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const bool = (v) => {
      if (v == null) return null;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (['0', 'false', 'off', 'no'].includes(s)) return false;
      if (['1', 'true', 'on', 'yes'].includes(s)) return true;
      return Boolean(v);
    };
    const result = await confirmOrder({
      orderId: numericId,
      customerName,
      email,
      notes,
      color,
      delivery,
      paymentMode,
      paymentUtr,
      material,
      layerHeightMm: num(layerHeightMm),
      supportsEnabled: bool(supportsEnabled),
      partWeightGrams: num(partWeightGrams),
      supportWeightGrams: num(supportWeightGrams),
      totalWeightGrams: num(totalWeightGrams),
      dimensionsMm: dimensionsMm && typeof dimensionsMm === 'object' ? dimensionsMm : null,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({
          success: false,
          error: 'not_found',
          message: `Order #${orderId} was not found.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: 'confirmation_failed',
        message: 'Failed to confirm order.',
      });
    }

    // Email notification via Resend. Failures are logged but must never fail the checkout request itself.
    // Receipts quote the grand total when delivery was settled, else the print total.
    let emailResult = null;
    try {
      emailResult = await sendOrderConfirmation(
        result.order.customerEmail,
        result.order.id,
        result.order.grandTotal ?? result.order.quotedPrice,
        buildTrackerUrl(req, result.order.id),
      );
    } catch (emailError) {
      console.error('[email] unexpected error sending confirmation:', emailError.message);
      emailResult = { success: false, error: emailError.message, previewUrl: null };
    }

    return res.status(200).json({
      success: true,
      orderId: result.order.id,
      order: result.order,
      message: 'Order confirmed successfully. Track progress at /track/' + result.order.id,
      email: emailResult,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/orders/delivery?orderId=:id&pincode=:pin
 *
 * Standalone delivery quote for the checkout form: recomputes the courier
 * charge from the stored order weight/dimensions and print total.
 * Registered before `/:id` so "delivery" is never treated as an order id.
 */
router.get('/delivery', async (req, res, next) => {
  try {
    const numericId = Number(req.query.orderId ?? req.query.order_id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_order_id',
        message: 'A valid orderId query parameter is required.',
      });
    }

    const pin = normalizePincode(req.query.pincode ?? req.query.pin_code ?? '');
    if (!pin) {
      return res.status(400).json({
        success: false,
        error: 'invalid_pincode',
        message: 'A 6-digit Indian delivery pincode is required.',
      });
    }

    const stored = await getOrderById(numericId);
    if (!stored) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Order #${req.query.orderId} was not found.`,
      });
    }

    const courierInfo = await getCourierEstimate({
      deliveryPin: pin,
      weightG: stored.weightG,
    });

    const delivery = calculateDelivery({
      weightG: stored.weightG,
      dimensionsMm: stored.dimensions,
      pincode: pin,
      orderValue: stored.quotedPrice,
      rawCourierCost: courierInfo?.rawCost || null,
    });

    delivery.courier = courierInfo;
    delivery.dispatchMessage = courierInfo.message || 'Flat ₹99 Pan-India Delivery via Delhivery / Blue Dart';

    return res.status(200).json({ success: true, orderId: numericId, delivery });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/orders/:id
 *
 * Public tracking lookup. Returns sanitized order metrics without internal server paths.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Invalid order ID.',
      });
    }

    const order = await getPublicOrderById(numericId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Order #${req.params.id} was not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/orders/:id/utr
 * PATCH /api/orders/:id/utr
 *
 * Saves or updates the 12-digit UPI UTR / Transaction ID on an existing order.
 */
async function handleOrderUtr(req, res, next) {
  try {
    const numericId = Number(req.params.id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_order_id',
        message: 'A valid numeric order ID is required.',
      });
    }

    const { utr, paymentUtr } = req.body || {};
    const candidate = utr || paymentUtr;
    if (!candidate || !String(candidate).trim()) {
      return res.status(400).json({
        success: false,
        error: 'missing_utr',
        message: 'A 12-digit UTR or Transaction ID is required.',
      });
    }

    const trimmed = String(candidate).trim();
    const result = await updateOrderUtr(numericId, trimmed);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({
          success: false,
          error: 'not_found',
          message: `Order #${numericId} was not found.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: 'update_failed',
        message: 'Failed to update payment UTR.',
      });
    }

    return res.json({
      success: true,
      orderId: numericId,
      utr: trimmed,
      order: result.order,
      message: 'Payment UTR / Transaction ID saved successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

router.post('/:id/utr', handleOrderUtr);
router.patch('/:id/utr', handleOrderUtr);

module.exports = router;

