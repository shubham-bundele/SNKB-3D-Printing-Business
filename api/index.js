'use strict';

/**
 * Vercel Serverless Function entry point for SNKB 3D Printing Express API.
 * Routes all /api/* requests to the Express application.
 */

const app = require('../src/app');

module.exports = app;
