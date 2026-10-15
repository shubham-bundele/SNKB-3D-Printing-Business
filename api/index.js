'use strict';

/**
 * Vercel Serverless Function entry point for SNKB 3D Printing Express API.
 * Routes /api and /api/* requests to the Express application.
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

module.exports = (req, res) => {
  if (bootError) {
    const message = String((bootError && bootError.message) || bootError);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ success: false, error: 'api_boot_failed', message }));
  }

  try {
    return app(req, res);
  } catch (err) {
    console.error('[api] invocation error:', (err && err.stack) || err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        success: false,
        error: 'api_invocation_error',
        message: String((err && err.message) || err),
      }));
    }
  }
};
