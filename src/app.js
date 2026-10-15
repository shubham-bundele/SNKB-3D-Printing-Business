'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Automatically load environment variables from .env in local development
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
} catch {
  /* ignore */
}

const express = require('express');
const cors = require('cors');
const multer = require('multer');

const quoteRouter = require('./routes/quote');
const adminRouter = require('./routes/admin');
const ordersRouter = require('./routes/orders');
const spoolsRouter = require('./routes/spools');
let telegramRouter = null;
try {
  telegramRouter = require('./routes/telegram');
} catch {
  /* optional telegram router */
}
const { resolveUploadDir } = require('./services/fileStorage');
const { adminPageAuthMiddleware } = require('./middleware/adminAuth');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * GET /api/health
 * Lightweight liveness probe used by the client and the API test suite.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'snkb-3d-printing-backend',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/storage/config
 * Public configuration endpoint for client direct uploads to Supabase Storage (bypassing Vercel's 4.5MB limit).
 */
app.get('/api/storage/config', (req, res) => {
  const url = process.env.SUPABASE_URL || null;
  const anonKey = process.env.SUPABASE_ANON_KEY || null;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'stl-uploads';
  const enabled = Boolean(url && anonKey && process.env.SNKB_DISABLE_SUPABASE_STORAGE !== '1');
  res.json({
    success: true,
    enabled,
    url: enabled ? url : null,
    anonKey: enabled ? anonKey : null,
    bucket,
  });
});

app.use('/api/quote', quoteRouter);
app.use('/api/admin', adminRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/spools', spoolsRouter);
if (telegramRouter) {
  app.use('/api/telegram', telegramRouter);
}

// Direct aliases for /admin/login and /admin/logout
app.post('/admin/login', (req, res) => {
  res.redirect(307, '/api/admin/login');
});
app.get('/admin/logout', (req, res) => {
  res.redirect('/api/admin/logout');
});

// Protect /admin routes using ADMIN_PASSCODE check (via cookie/header/query)
app.use('/admin', adminPageAuthMiddleware);

// Serve static frontend assets if built
const distPath = path.join(__dirname, '..', 'dist');
const samplesPath = path.join(__dirname, '..', 'public', 'samples');

if (fs.existsSync(samplesPath)) {
  app.use('/samples', express.static(samplesPath));
}

// Persisted STL uploads (served so the admin table can download original geometry).
app.use('/uploads', express.static(resolveUploadDir()));

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // Dynamic public order tracking route fallback for live client viewing
  app.get('/track/:id', (req, res, next) => {
    const specificPath = path.join(distPath, 'track', req.params.id, 'index.html');
    if (fs.existsSync(specificPath)) {
      return res.sendFile(specificPath);
    }
    const samplePath = path.join(distPath, 'track', 'sample', 'index.html');
    if (fs.existsSync(samplePath)) {
      return res.sendFile(samplePath);
    }
    next();
  });

  // Dynamic public shareable 3D quote route fallback
  app.get('/quote/:id', (req, res, next) => {
    const specificPath = path.join(distPath, 'quote', req.params.id, 'index.html');
    if (fs.existsSync(specificPath)) {
      return res.sendFile(specificPath);
    }
    const samplePath = path.join(distPath, 'quote', 'sample', 'index.html');
    if (fs.existsSync(samplePath)) {
      return res.sendFile(samplePath);
    }
    next();
  });
}

// Unknown route.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'not_found',
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// Global error handler. Multer errors (size limit, unexpected field) and the
// file-filter rejection both map to HTTP 400.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: 'upload_error',
      code: err.code,
      message: err.message,
    });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }

  return res.status(status).json({
    success: false,
    error: err.code || 'server_error',
    message: err.message || 'Internal server error',
  });
});

module.exports = app;
