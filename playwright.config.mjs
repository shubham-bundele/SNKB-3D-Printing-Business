import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Playwright E2E configuration for the SNKB 3D Printing storefront.
 *
 * The E2E run spins up the production stack the way `npm start` does: a single
 * Express process serves the prebuilt Astro frontend (dist/) AND the live API
 * (/api/quote, /api/orders/confirm, /api/orders/:id) on one port. This keeps
 * the browser test end-to-end against the real HTTP + SQLite + email path.
 *
 * Hermetic by default: an isolated temp SQLite database (SNKB_DB_PATH), temp
 * upload dir, and a dedicated port (3100) are injected into the server env so
 * local development data is never touched.
 */
const E2E_PORT = 3100;
const runSuffix = crypto.randomBytes(4).toString('hex');
const e2eDbPath = path.join(os.tmpdir(), `snkb-e2e-${runSuffix}.sqlite`);
const e2eUploadDir = path.join(os.tmpdir(), `snkb-e2e-uploads-${runSuffix}`);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // the checkout flow mutates shared DB state — run serially
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(E2E_PORT),
      SNKB_DB_PATH: e2eDbPath,
      SNKB_UPLOAD_DIR: e2eUploadDir,
    },
  },
});