'use strict';

/**
 * Vercel Serverless Function entry point for SNKB 3D Printing Express API.
 * Routes all /api/* requests to the Express application.
 *
 * The require is wrapped so that a boot-time failure surfaces as readable
 * JSON (api_boot_failed) instead of an opaque FUNCTION_INVOCATION_FAILED.
 */

let app = null;
let bootError = null;

try {
  // eslint-disable-next-line global-require
  app = require('../src/app');
} catch (err) {
  bootError = err;
  console.error('[api] boot failure:', (err && err.stack) || err);
}

if (bootError) {
  const message = String((bootError && bootError.message) || bootError);
  module.exports = (req, res) => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'api_boot_failed', message }));
  };
} else {
  module.exports = app;
}
