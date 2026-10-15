'use strict';

const express = require('express');
const { listSpools, updateSpoolRemaining } = require('../db/database');
const { adminAuthMiddleware } = require('../middleware/adminAuth');

const router = express.Router();

/**
 * GET /api/spools
 * Public endpoint to fetch all active filament spools with remaining stock in grams.
 */
router.get('/', async (req, res, next) => {
  try {
    const spools = await listSpools();
    return res.status(200).json({
      success: true,
      spools,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /api/admin/spools/:id
 * Admin-protected endpoint to update remaining grams for a specific filament spool.
 */
router.patch('/admin/:id', adminAuthMiddleware, async (req, res, next) => {
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

    return res.status(200).json({
      success: true,
      spool: updated,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
