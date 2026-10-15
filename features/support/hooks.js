'use strict';

const { BeforeAll, AfterAll, Before, After } = require('@cucumber/cucumber');
const { request } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');

// Hermetic persistence for acceptance runs: an ephemeral SQLite file and a
// scratch upload dir, so scenarios never touch the development database.
process.env.SNKB_DB_PATH ||= path.join(os.tmpdir(), `snkb-cucumber-${process.pid}.sqlite`);
process.env.SNKB_UPLOAD_DIR ||= path.join(os.tmpdir(), `snkb-cucumber-uploads-${process.pid}`);

const app = require('../../src/app');

let server;
let baseURL;

/**
 * Boot the Express app once on an ephemeral port for the whole run. Playwright's
 * APIRequestContext is created per scenario so each one starts from a clean slate.
 */
BeforeAll(async function () {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
});

Before(async function () {
  this.api = await request.newContext({ baseURL });
});

After(async function () {
  if (this.api) {
    await this.api.dispose();
    this.api = null;
  }
});

AfterAll(async function () {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});
