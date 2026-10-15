'use strict';

const express = require('express');

const { upload } = require('../middleware/upload');
const { parseStl } = require('../services/stlParser');
const {
  saveUpload,
  saveUploadAsync,
  getSupabaseStorageClient,
  resolveStorageBucket,
  extractStorageKey,
} = require('../services/fileStorage');
const { createOrder, getOrderById, DEFAULT_ORDER_STATUS } = require('../db/database');
const {
  BUILD_VOLUME_LIMIT_MM,
  validateBuildVolume,
  buildQuote,
} = require('../services/quoteCalculator');

const router = express.Router();

/**
 * POST /api/quote
 *
 * Accepts a multipart/form-data STL upload or direct Supabase storagePath
 * (bypassing Vercel's 4.5MB payload limit). The parser detects Binary vs ASCII
 * automatically. Oversized models are rejected with HTTP 400 before any pricing
 * is calculated.
 *
 * Persists the quote into Supabase Postgres (or in-memory store) as a Pending order.
 */
router.post('/', upload.any(), async (req, res, next) => {
  try {
    const file = (req.files && req.files[0]) || req.file;
    const storagePath = req.body && req.body.storagePath;

    let geometry;
    let fileName = (file && file.originalname) || (req.body && req.body.fileName) || 'model.stl';
    let storedPath = storagePath || null;

    if (file) {
      try {
        geometry = parseStl(file.buffer, file.originalname);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'invalid_stl',
          message: error.message,
        });
      }
    } else if (storedPath) {
      // Direct Supabase Storage upload (bypasses Vercel 4.5MB limit)
      const supabase = getSupabaseStorageClient();
      if (supabase) {
        const bucket = resolveStorageBucket();
        const cleanKey = extractStorageKey(storedPath, bucket);
        try {
          const { data: fileData, error: dlError } = await supabase.storage.from(bucket).download(cleanKey);
          if (!dlError && fileData) {
            const arrayBuf = await fileData.arrayBuffer();
            geometry = parseStl(Buffer.from(arrayBuf), fileName);
          }
        } catch {
          /* fallback to client geometry */
        }
      }
      if (!geometry && req.body.volumeMm3 && req.body.dimensions) {
        const rawDims = typeof req.body.dimensions === 'string' ? JSON.parse(req.body.dimensions) : req.body.dimensions;
        geometry = {
          dimensions: rawDims,
          volumeMm3: Number(req.body.volumeMm3),
          surfaceAreaMm2: Number(req.body.surfaceAreaMm2 || req.body.volumeMm3 * 0.4),
          triangleCount: Number(req.body.triangleCount || 100),
          format: fileName.toLowerCase().endsWith('.3mf') ? '3mf' : 'binary',
        };
      }
      if (!geometry) {
        return res.status(400).json({
          success: false,
          error: 'invalid_stl',
          message: 'Unable to parse 3D geometry from Supabase storage.',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'missing_file',
        message: 'No STL file was uploaded. Attach a .stl or .3mf file using the "file" form field.',
      });
    }

    const scaleFactor = Number(req.body && (req.body.scaleFactor || (req.body.scalePercent ? Number(req.body.scalePercent) / 100 : null)));
    if (scaleFactor && scaleFactor > 0 && scaleFactor !== 1) {
      geometry.dimensions = {
        x: Number((geometry.dimensions.x * scaleFactor).toFixed(2)),
        y: Number((geometry.dimensions.y * scaleFactor).toFixed(2)),
        z: Number((geometry.dimensions.z * scaleFactor).toFixed(2)),
      };
      geometry.volumeMm3 = Number((geometry.volumeMm3 * Math.pow(scaleFactor, 3)).toFixed(2));
      geometry.surfaceAreaMm2 = Number((geometry.surfaceAreaMm2 * Math.pow(scaleFactor, 2)).toFixed(2));
    }

    const validation = validateBuildVolume(geometry.dimensions);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'build_volume_exceeded',
        message:
          `Model exceeds the maximum build volume of ` +
          `${BUILD_VOLUME_LIMIT_MM} \u00d7 ${BUILD_VOLUME_LIMIT_MM} \u00d7 ${BUILD_VOLUME_LIMIT_MM} mm.`,
        buildVolume: {
          x: BUILD_VOLUME_LIMIT_MM,
          y: BUILD_VOLUME_LIMIT_MM,
          z: BUILD_VOLUME_LIMIT_MM,
        },
        dimensions: {
          x: geometry.dimensions.x,
          y: geometry.dimensions.y,
          z: geometry.dimensions.z,
        },
        exceededAxes: validation.exceededAxes,
      });
    }

    const quoteOptions = {
      material: req.body && (req.body.material || req.body.materialType),
      profile: req.body && (req.body.profile || req.body.printProfile),
      layerHeightMm: req.body && (req.body.layerHeightMm || req.body.layer_height || req.body.layerHeight || null),
      infillPercent: req.body && (req.body.infillPercent != null ? Number(req.body.infillPercent) : (req.body.infill != null ? Number(req.body.infill) : (req.body.infillPercentage != null ? Number(req.body.infillPercentage) : null))),
      quantity: req.body && req.body.quantity,
      overhangAreaMm2: req.body && (req.body.overhangAreaMm2 || req.body.overhangArea),
      avgOverhangHeightMm: req.body && (req.body.avgOverhangHeightMm || req.body.overhangHeight),
      totalAreaMm2: req.body && (req.body.totalAreaMm2 || null),
      supportsEnabled: req.body && (req.body.supportsEnabled ?? req.body.supports_enabled ?? req.body.supports ?? true),
      addOns: req.body && (typeof req.body.addOns === 'string' ? JSON.parse(req.body.addOns) : req.body.addOns),
    };
    // Normalize supportsEnabled from form-data strings ("0"/"false"/"1")
    if (typeof quoteOptions.supportsEnabled === 'string') {
      const v = quoteOptions.supportsEnabled.trim().toLowerCase();
      quoteOptions.supportsEnabled = !(v === '0' || v === 'false' || v === 'off' || v === 'no');
    }

    const quote = buildQuote(geometry, file || { originalname: fileName }, quoteOptions);

    // Persist the original geometry to disk and Supabase Storage if file was uploaded directly.
    if (file && !storedPath) {
      try {
        const stored = await saveUploadAsync(file);
        if (stored) {
          storedPath = stored.storedPath;
        }
      } catch (storageError) {
        console.error('[quote] failed to persist uploaded STL:', storageError.message);
      }
    }

    // Every accepted, in-bounds quote becomes a Pending order in Supabase / shop queue.
    // quotedPrice stores the customer-facing total (material + machine time +
    // fixed service charge, floored at the minimum order value).
    let clientDims = null;
    try {
      const rawDims = req.body && req.body.dimensions;
      clientDims = typeof rawDims === 'string' ? JSON.parse(rawDims) : (rawDims || null);
    } catch { clientDims = null; }
    const order = await createOrder({
      customerName: (req.body && (req.body.customer_name || req.body.customerName)) || 'Guest',
      customerEmail: req.body && req.body.email,
      fileName,
      filePath: storedPath,
      volumeMm3: quote.volumeMm3,
      weightG: quote.weightGrams,
      partWeightG: quote.partWeightGrams ?? null,
      supportWeightG: quote.supportWeightGrams ?? 0,
      supportsEnabled: quote.supportsEnabled ?? true,
      totalWeightG: quote.weightGrams ?? null,
      material: (quote.material && quote.material.id) || quoteOptions.material || 'pla',
      layerHeightMm: quote.layerHeightMm ?? (quote.profile && quote.profile.layerHeightMm) ?? null,
      dimensions: quote.dimensions,
      dimensionsMm: clientDims || quote.dimensions,
      quotedPrice: quote.totalPrice,
      color: (req.body && req.body.color) || 'Concrete Grey',
      notes: (req.body && (req.body.notes || req.body.customer_notes)) || null,
      status: DEFAULT_ORDER_STATUS,
    });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      order,
      ...quote,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/quote/share
 *
 * Saves or updates a shareable 3D quote draft and returns a permalink.
 */
router.post('/share', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body || Object.keys(body).length === 0 || (!body.fileName && !body.orderId && !body.totalPrice && !body.quotedPrice)) {
      return res.status(400).json({
        success: false,
        error: 'missing_quote_data',
        message: 'Valid quote data with fileName is required to create a shareable quote.',
      });
    }

    const {
      orderId,
      fileName,
      filePath,
      dimensions,
      volumeMm3,
      weightGrams,
      quotedPrice,
      totalPrice,
      color,
      material,
      profile,
      quantity,
      addOns,
      notes,
    } = body;

    let order = null;

    if (orderId) {
      order = await getOrderById(orderId);
    }

    const effectivePrice = Number(totalPrice ?? quotedPrice ?? 149);
    const meta = {
      material: material || 'pla',
      profile: profile || 'standard',
      quantity: quantity || 1,
      addOns: addOns || {},
      sharedAt: new Date().toISOString(),
      userNotes: notes || null,
    };

    const notesWithMeta = JSON.stringify({
      type: 'SHARED_QUOTE_DRAFT',
      ...meta,
    });

    if (!order) {
      order = await createOrder({
        customerName: 'Guest',
        fileName: fileName || 'model.stl',
        filePath: filePath || null,
        volumeMm3: volumeMm3 ? Number(volumeMm3) : null,
        weightG: weightGrams ? Number(weightGrams) : null,
        dimensions: dimensions || { x: 50, y: 50, z: 50 },
        quotedPrice: effectivePrice,
        color: color || 'Concrete Grey',
        notes: notesWithMeta,
        status: DEFAULT_ORDER_STATUS,
      });
    }

    const shareId = String(order.id);
    const shareUrl = `/quote/${shareId}`;

    return res.status(200).json({
      success: true,
      quoteId: order.id,
      shareId,
      shareUrl,
      order,
      quote: {
        ...order,
        shareId,
        fileName: order.fileName,
        material: meta.material,
        profile: meta.profile,
        quantity: meta.quantity,
        totalPrice: order.quotedPrice,
        addOns: meta.addOns,
        meta,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/quote/:id
 *
 * Public endpoint to retrieve a shareable quote draft.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const order = await getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Quote #${id} was not found.`,
      });
    }

    let meta = null;
    if (order.notes) {
      try {
        meta = JSON.parse(order.notes);
      } catch {
        meta = { rawNotes: order.notes };
      }
    }

    const shareId = String(order.id);
    return res.status(200).json({
      success: true,
      quote: {
        ...order,
        shareId,
        material: meta?.material || 'pla',
        profile: meta?.profile || 'standard',
        quantity: meta?.quantity || 1,
        totalPrice: order.quotedPrice,
        addOns: meta?.addOns || {},
        meta,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

