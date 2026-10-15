'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const runId = `admin-email-${process.pid}-${Date.now()}`;
const dbPath = path.join(os.tmpdir(), `snkb-admin-email-${runId}.sqlite`);
const uploadDir = path.join(os.tmpdir(), `snkb-admin-email-uploads-${runId}`);

process.env.SNKB_DB_PATH = dbPath;
process.env.SNKB_UPLOAD_DIR = uploadDir;
// Enable email testing but we will inspect mock/behavior
process.env.SNKB_EMAIL_ENABLED = '0'; // Hermetic: doesn't reach outside network

const app = require('../src/app');
const { createOrder, getOrderById } = require('../src/db/database');
const { sendStatusUpdateEmail } = require('../src/services/email');

let server;
let baseURL;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('sendStatusUpdateEmail unit tests - status filters and validation', async () => {
  // 1. Skips unsupported statuses
  const pendingRes = await sendStatusUpdateEmail({
    customerEmail: 'test@example.com',
    orderId: 101,
    status: 'Pending',
  });
  assert.equal(pendingRes.skipped, true);

  // 2. Skips invalid email
  const invalidEmailRes = await sendStatusUpdateEmail({
    customerEmail: 'not-an-email',
    orderId: 101,
    status: 'Printing',
  });
  assert.equal(invalidEmailRes.skipped, true);

  // 3. Printing status runs safely when email disabled (returns skipped: true)
  const printingRes = await sendStatusUpdateEmail({
    customerEmail: 'customer@example.com',
    orderId: 101,
    status: 'Printing',
  });
  assert.equal(printingRes.skipped, true);

  // 4. Shipped status runs safely with courier URL
  const shippedRes = await sendStatusUpdateEmail({
    customerEmail: 'customer@example.com',
    orderId: 101,
    status: 'Shipped',
    courierTrackingUrl: 'https://www.delhivery.com/track/package/DEL123456789',
  });
  assert.equal(shippedRes.skipped, true);
});

test('PATCH /api/admin/orders/:id updates status to Printing and triggers status email', async () => {
  const order = await createOrder({
    customerName: 'Aarav Patel',
    customerEmail: 'aarav.patel@example.com',
    quotedPrice: 349,
    status: 'Slicing',
  });

  const res = await fetch(`${baseURL}/api/admin/orders/${order.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Printing' }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.order.status, 'Printing');
  assert.ok(data.email, 'email result should be returned');
  assert.equal(data.email.skipped, true); // Since SNKB_EMAIL_ENABLED=0 in test

  // Verify DB state
  const updated = await getOrderById(order.id);
  assert.equal(updated.status, 'Printing');
});

test('PATCH /api/admin/orders/:id updates status to Shipped with courierTrackingUrl', async () => {
  const order = await createOrder({
    customerName: 'Priya Sharma',
    customerEmail: 'priya.sharma@example.com',
    quotedPrice: 599,
    status: 'Printing',
  });

  const courierUrl = 'https://www.delhivery.com/track/package/DEL987654321';
  const res = await fetch(`${baseURL}/api/admin/orders/${order.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'Shipped',
      courierTrackingUrl: courierUrl,
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.order.status, 'Shipped');
  assert.equal(data.order.courierTrackingUrl, courierUrl);
  assert.ok(data.email);

  // Verify DB persistence of courier_tracking_url
  const updated = await getOrderById(order.id);
  assert.equal(updated.status, 'Shipped');
  assert.equal(updated.courierTrackingUrl, courierUrl);
});

test('Admin Route Protection with ADMIN_PASSCODE via cookie and headers', async () => {
  process.env.ADMIN_PASSCODE = 'super-secret-pass-2026';

  try {
    // 1. Without auth: GET /admin returns 401
    const unauthPage = await fetch(`${baseURL}/admin`);
    assert.equal(unauthPage.status, 401);
    const unauthHtml = await unauthPage.text();
    assert.ok(unauthHtml.includes('Terminal Locked'));
    assert.ok(unauthHtml.includes('ADMIN_PASSCODE'));

    // 2. Without auth: GET /api/admin/orders returns 401 JSON
    const unauthApi = await fetch(`${baseURL}/api/admin/orders`);
    assert.equal(unauthApi.status, 401);
    const unauthJson = await unauthApi.json();
    assert.equal(unauthJson.error, 'unauthorized');

    // 3. With header: GET /api/admin/orders returns 200
    const headerApi = await fetch(`${baseURL}/api/admin/orders`, {
      headers: { 'x-admin-passcode': 'super-secret-pass-2026' },
    });
    assert.equal(headerApi.status, 200);

    // 4. Authenticate via POST /api/admin/login -> sets cookie
    const loginRes = await fetch(`${baseURL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'super-secret-pass-2026' }),
    });
    assert.equal(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader);
    assert.ok(cookieHeader.includes('admin_passcode=super-secret-pass-2026'));

    // 5. With cookie: GET /admin passes through
    const cookiePage = await fetch(`${baseURL}/admin`, {
      headers: { cookie: 'admin_passcode=super-secret-pass-2026' },
    });
    // If dist/admin/index.html is not served or served, it must NOT be 401!
    assert.notEqual(cookiePage.status, 401);

    // 6. With cookie: GET /api/admin/orders returns 200
    const cookieApi = await fetch(`${baseURL}/api/admin/orders`, {
      headers: { cookie: 'admin_passcode=super-secret-pass-2026' },
    });
    assert.equal(cookieApi.status, 200);

  } finally {
    delete process.env.ADMIN_PASSCODE;
  }
});
