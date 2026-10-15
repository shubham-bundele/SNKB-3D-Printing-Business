'use strict';

/**
 * Private admin API backing the order dashboard.
 *
 *   POST  /api/admin/login         -> authenticate via passcode, set cookie
 *   GET   /api/admin/logout        -> clear admin cookie
 *   POST  /api/admin/verify        -> test auth clearance, set cookie
 *   GET   /api/admin/orders        -> all orders from Supabase, newest first
 *   GET   /api/admin/orders/:id    -> a single order
 *   PATCH /api/admin/orders/:id    -> update an order's status + auto email for Printing/Shipped
 */

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  listOrders,
  getOrderById,
  updateOrderStatus,
  clearOrderFilePaths,
  listOrdersForStorageCleanup,
  isValidStatus,
  ORDER_STATUSES,
  listSpools,
  updateSpoolRemaining,
} = require('../db/database');
const {
  createSignedDownloadUrl,
  deleteFromStorage,
  resolveUploadDir,
} = require('../services/fileStorage');
const { adminAuthMiddleware, getConfiguredSecret } = require('../middleware/adminAuth');
const { sendStatusUpdateEmail } = require('../services/email');

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

/** POST /api/admin/login — authenticate via passcode, set cookie and/or return JSON */
router.post('/login', (req, res) => {
  const secret = getConfiguredSecret();
  const { passcode, token, redirect: redirectUrl } = req.body || {};
  const candidate =
    passcode ||
    token ||
    (req.query && req.query.passcode) ||
    req.headers['x-admin-passcode'] ||
    req.headers['x-admin-token'];

  const isValid = !secret || (candidate && String(candidate).trim() === secret);
  if (!isValid) {
    if (redirectUrl) {
      return res.redirect(401, '/admin?error=invalid_passcode');
    }
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Invalid admin passcode.',
    });
  }

  if (secret) {
    res.cookie('admin_passcode', secret, {
      path: '/',
      httpOnly: false,
      maxAge: 86400 * 1000,
      sameSite: 'lax',
    });
  }

  if (redirectUrl) {
    return res.redirect(redirectUrl);
  }
  return res.json({ success: true, authorized: true });
});

/** GET /api/admin/logout — clear cookie and redirect */
router.get('/logout', (req, res) => {
  res.clearCookie('admin_passcode', { path: '/' });
  res.clearCookie('admin_token', { path: '/' });
  return res.redirect('/admin');
});

// Require admin authentication for all subsequent endpoints
router.use(adminAuthMiddleware);

/** POST /api/admin/verify — test auth clearance and refresh cookie */
router.post('/verify', (req, res) => {
  const secret = getConfiguredSecret();
  if (secret) {
    res.cookie('admin_passcode', secret, {
      path: '/',
      httpOnly: false,
      maxAge: 86400 * 1000,
      sameSite: 'lax',
    });
  }
  return res.json({ success: true, authorized: true });
});

/** GET /api/admin/orders */
router.get('/orders', async (req, res, next) => {
  try {
    const orders = await listOrders();
    return res.json({
      success: true,
      count: orders.length,
      statuses: ORDER_STATUSES,
      orders,
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/admin/orders/:id */
router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'order_not_found',
        message: `Order ${req.params.id} was not found.`,
      });
    }
    return res.json({ success: true, order });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/admin/orders/:id  { status, courierTrackingUrl, trackingUrl }
 *
 * Updates status and optional courier tracking URL. When updated to Printing or Shipped,
 * automatically dispatches a Resend notification email to the customer.
 */
router.patch('/orders/:id', async (req, res, next) => {
  try {
    const status = req.body && req.body.status;
    const courierTrackingUrl = req.body && (req.body.courierTrackingUrl || req.body.trackingUrl || null);

    if (!isValidStatus(status)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_status',
        message: `"status" must be one of: ${ORDER_STATUSES.join(', ')}.`,
        allowedStatuses: ORDER_STATUSES,
      });
    }

    const result = await updateOrderStatus(req.params.id, status, { courierTrackingUrl });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({
          success: false,
          error: 'order_not_found',
          message: `Order ${req.params.id} was not found.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: result.reason,
        allowedStatuses: ORDER_STATUSES,
      });
    }

    // Automatically trigger a Resend status update email to the customer when updated to Printing or Shipped
    let emailResult = null;
    if (status === 'Printing' || status === 'Shipped') {
      const order = result.order;
      if (order.customerEmail) {
        const publicTrackerUrl = buildTrackerUrl(req, order.id);
        try {
          emailResult = await sendStatusUpdateEmail({
            customerEmail: order.customerEmail,
            orderId: order.id,
            status,
            courierTrackingUrl: courierTrackingUrl || order.courierTrackingUrl,
            trackerUrl: publicTrackerUrl,
          });
        } catch (emailErr) {
          console.error(`[email] Failed to send status update email for order ${order.id}:`, emailErr.message);
          emailResult = { success: false, error: emailErr.message };
        }
      } else {
        emailResult = { success: false, skipped: true, reason: 'no_customer_email' };
      }
    }

    return res.json({
      success: true,
      order: result.order,
      email: emailResult,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/orders/:id/download
 *
 * Generates a signed download URL from Supabase Storage for the order's 3D file,
 * or serves the local file if running offline.
 * Supports ?json=1 to return { success: true, downloadUrl, fileName }
 * or direct redirect / download.
 */
router.get('/orders/:id/download', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'order_not_found',
        message: `Order #${req.params.id} was not found.`,
      });
    }

    if (!order.filePath) {
      return res.status(404).json({
        success: false,
        error: 'file_not_found',
        message: `Order #${req.params.id} has no stored 3D file (may have been cleaned up).`,
      });
    }

    // Try generating a Supabase Storage signed download URL (valid for 1 hour)
    const signedResult = await createSignedDownloadUrl(order.filePath, 3600);
    if (signedResult && signedResult.signedUrl) {
      if (req.query.json === '1') {
        return res.json({
          success: true,
          downloadUrl: signedResult.signedUrl,
          fileName: order.fileName || 'model.stl',
          provider: 'supabase',
          expiresIn: 3600,
        });
      }
      return res.redirect(signedResult.signedUrl);
    }

    // Fallback: check local disk
    const uploadDir = resolveUploadDir();
    const fileName = path.basename(order.filePath);
    const localCandidate = path.join(uploadDir, fileName);
    if (fs.existsSync(localCandidate)) {
      if (req.query.json === '1') {
        return res.json({
          success: true,
          downloadUrl: `/${order.filePath}`,
          fileName: order.fileName || fileName,
          provider: 'local',
        });
      }
      return res.download(localCandidate, order.fileName || fileName);
    }

    return res.status(404).json({
      success: false,
      error: 'file_not_found',
      message: `The 3D file for order #${req.params.id} was not found on storage or disk.`,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/admin/storage/cleanup
 *
 * Permanently deletes uploaded 3D files for completed (and cancelled) orders
 * from Supabase Storage and local disk to stay within the 1 GB Supabase free tier.
 * Updates order records setting file_path to null.
 */
router.post('/storage/cleanup', async (req, res, next) => {
  try {
    const completedOrders = await listOrdersForStorageCleanup();
    if (!completedOrders || completedOrders.length === 0) {
      return res.json({
        success: true,
        message: 'No completed orders with stored 3D files found. Storage is already optimized.',
        cleanedCount: 0,
        freedOrders: [],
      });
    }

    const freedOrders = [];
    for (const order of completedOrders) {
      if (order.filePath) {
        await deleteFromStorage(order.filePath);
        freedOrders.push(order.id);
      }
    }

    if (freedOrders.length > 0) {
      await clearOrderFilePaths(freedOrders);
    }

    return res.json({
      success: true,
      message: `Successfully deleted 3D files for ${freedOrders.length} completed order(s) to free storage.`,
      cleanedCount: freedOrders.length,
      freedOrders,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/admin/spools
 * Admin-protected endpoint to fetch filament spools with stock levels.
 */
router.get('/spools', async (req, res, next) => {
  try {
    const spools = await listSpools();
    return res.json({
      success: true,
      spools,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/admin/spools/:id
 * Admin-protected endpoint to update remaining grams on a spool.
 */
router.patch('/spools/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_id',
        message: 'Spool ID must be a positive integer.',
      });
    }

    const remainingGrams = req.body.remainingGrams ?? req.body.remaining_grams;
    if (remainingGrams === undefined || isNaN(Number(remainingGrams)) || Number(remainingGrams) < 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_grams',
        message: 'remainingGrams must be a non-negative number.',
      });
    }

    const updated = await updateSpoolRemaining(id, Number(remainingGrams));
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'spool_not_found',
        message: `Filament spool with ID ${id} not found.`,
      });
    }

    return res.json({
      success: true,
      spool: updated,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

