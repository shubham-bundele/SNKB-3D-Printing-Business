'use strict';

/**
 * End-to-end test of the SQLite persistence + live admin API:
 * quote -> orders table -> GET/PATCH /api/admin/orders.
 *
 * Uses an ephemeral on-disk database so the file-generation behaviour (Part of
 * "database file is generated") is verified without touching dev data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const runId = `${process.pid}-${Date.now()}`;
const dbPath = path.join(os.tmpdir(), `snkb-orders-${runId}.sqlite`);
const uploadDir = path.join(os.tmpdir(), `snkb-orders-uploads-${runId}`);

process.env.SNKB_DB_PATH = dbPath;
process.env.SNKB_UPLOAD_DIR = uploadDir;

const app = require('../src/app');
const {
  createBinaryBoxStlBuffer,
  createAsciiBoxStlBuffer,
} = require('./helpers/stlGenerator');

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

async function uploadQuote(buffer, filename = 'model.stl') {
  const form = new FormData();
  form.append('customer_name', 'Integration Tester');
  form.append('file', new Blob([buffer], { type: 'model/stl' }), filename);
  return fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
}

async function adminOrders() {
  const response = await fetch(`${baseURL}/api/admin/orders`);
  assert.equal(response.status, 200);
  return response.json();
}

test('Orders persistence layer initializes on first DB-touching API call', async () => {
  const health = await fetch(`${baseURL}/api/health`);
  assert.equal(health.status, 200);

  // First touch of the database: the admin listing must initialize and return empty list
  const body = await adminOrders();
  assert.equal(body.success, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.orders, []);
});

test('POST /api/quote persists a Pending order and returns orderId', async () => {
  const buffer = createAsciiBoxStlBuffer({ x: 24, y: 25, z: 25 }); // 15000 mm^3
  const response = await uploadQuote(buffer, 'esp32_wled_case.stl');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);

  assert.ok(Number.isInteger(body.orderId), 'orderId should be returned alongside pricing');
  assert.equal(body.volumeMm3, 15000);
  assert.equal(body.materialCost, 37.2);
  assert.equal(body.totalPrice, 159);

  // Persisted record assertions
  assert.equal(body.order.id, body.orderId);
  assert.equal(body.order.customerName, 'Integration Tester');
  assert.equal(body.order.fileName, 'esp32_wled_case.stl');
  assert.equal(body.order.status, 'Pending');
  assert.equal(body.order.volumeMm3, 15000);
  assert.equal(body.order.weightG, 18.6);
  assert.equal(body.order.quotedPrice, 159);
  assert.deepEqual(body.order.dimensions, { x: 24, y: 25, z: 25 });
  assert.ok(body.order.createdAt, 'created_at should be populated');

  assert.ok(
    typeof body.order.filePath === 'string' && body.order.filePath.length > 0,
    'file_path should be persisted'
  );
  const localDiskCandidate = path.isAbsolute(body.order.filePath)
    ? body.order.filePath
    : path.join(uploadDir, path.basename(body.order.filePath));
  assert.ok(
    fs.existsSync(body.order.filePath) || fs.existsSync(localDiskCandidate),
    'uploaded STL should exist on disk at file_path'
  );
});

test('GET /api/admin/orders returns all orders sorted by created_at DESC', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 20, y: 20, z: 20 });
  const first = await (await uploadQuote(buffer, 'cube_one.stl')).json();
  const second = await (await uploadQuote(buffer, 'cube_two.stl')).json();

  const list = (await adminOrders()).orders;
  assert.ok(list.length >= 2, 'at least two orders should be listed');
  assert.equal(list[0].id, second.orderId, 'newest order must come first');
  assert.equal(list[1].id, first.orderId);
});

test('PATCH /api/admin/orders/:id updates status', async () => {
  const list = (await adminOrders()).orders;
  const target = list[0];

  const response = await fetch(`${baseURL}/api/admin/orders/${target.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Printing' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.order.id, target.id);
  assert.equal(body.order.status, 'Printing');

  // Verify persistence by re-reading through the admin listing.
  const refreshed = (await adminOrders()).orders.find((o) => o.id === target.id);
  assert.equal(refreshed.status, 'Printing');
});

test('PATCH /api/admin/orders/:id rejects an invalid status with 400', async () => {
  const list = (await adminOrders()).orders;
  const target = list[0];

  const response = await fetch(`${baseURL}/api/admin/orders/${target.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Delivered' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'invalid_status');
  assert.ok(Array.isArray(body.allowedStatuses));
  assert.ok(body.allowedStatuses.includes('Pending'));
  assert.ok(body.allowedStatuses.includes('Completed'));
  assert.ok(body.allowedStatuses.includes('Cancelled'));
});

test('PATCH /api/admin/orders/:id returns 404 for an unknown order', async () => {
  const response = await fetch(`${baseURL}/api/admin/orders/999999`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Slicing' }),
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'order_not_found');
});

test('GET /api/admin/orders/:id returns a single order or 404', async () => {
  const list = (await adminOrders()).orders;
  const single = await fetch(`${baseURL}/api/admin/orders/${list[0].id}`);
  assert.equal(single.status, 200);
  assert.equal((await single.json()).order.id, list[0].id);

  const missing = await fetch(`${baseURL}/api/admin/orders/424242`);
  assert.equal(missing.status, 404);
});

test('Oversized models are rejected and never written to the orders table', async () => {
  const before = (await adminOrders()).count;

  const buffer = createBinaryBoxStlBuffer({ x: 200, y: 50, z: 50 });
  const response = await uploadQuote(buffer, 'oversized.stl');
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'build_volume_exceeded');

  const after = (await adminOrders()).count;
  assert.equal(after, before, 'rejected models must not create an order record');
});

test('orders table exposes the full schema fields', async () => {
  const { createOrder } = require('../src/db/database');
  const sample = await createOrder({
    customerName: 'Schema Check',
    fileName: 'test.stl',
    filePath: 'uploads/test.stl',
    volumeMm3: 12000,
    weightG: 14.88,
    dimensions: { x: 20, y: 20, z: 20 },
    quotedPrice: 0.30,
    status: 'Pending',
  });

  for (const expected of [
    'id',
    'customerName',
    'fileName',
    'filePath',
    'volumeMm3',
    'weightG',
    'dimensions',
    'quotedPrice',
    'status',
    'createdAt',
  ]) {
    assert.ok(expected in sample, `order.${expected} property should exist in schema`);
  }
});

test('GET /api/storage/config returns storage bucket configuration', async () => {
  const res = await fetch(`${baseURL}/api/storage/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(typeof data.enabled, 'boolean');
  assert.equal(data.bucket, 'stl-uploads');
});

test('GET /api/admin/orders/:id/download handles signed URL and local downloads', async () => {
  const { createOrder } = require('../src/db/database');
  const dummyFile = path.join(uploadDir, 'download-sample.stl');
  fs.writeFileSync(dummyFile, 'solid sample\nendsolid sample');

  const order = await createOrder({
    customerName: 'Download Tester',
    fileName: 'download-sample.stl',
    filePath: 'uploads/download-sample.stl',
    volumeMm3: 1000,
    weightG: 1.2,
    dimensions: { x: 10, y: 10, z: 10 },
    quotedPrice: 10.0,
    status: 'Pending',
  });

  // Query with json=1
  const jsonRes = await fetch(`${baseURL}/api/admin/orders/${order.id}/download?json=1`);
  assert.equal(jsonRes.status, 200);
  const jsonData = await jsonRes.json();
  assert.equal(jsonData.success, true);
  assert.ok(jsonData.downloadUrl);
  assert.ok(jsonData.provider === 'supabase' || jsonData.provider === 'local');

  // Query on unknown order returns 404
  const notFoundRes = await fetch(`${baseURL}/api/admin/orders/888888/download`);
  assert.equal(notFoundRes.status, 404);

  // Query on order without filePath returns 404
  const noFileOrder = await createOrder({
    customerName: 'No File Tester',
    fileName: 'missing.stl',
    filePath: null,
    volumeMm3: 500,
    weightG: 0.6,
    dimensions: { x: 5, y: 5, z: 5 },
    quotedPrice: 5.0,
    status: 'Pending',
  });
  const noFileRes = await fetch(`${baseURL}/api/admin/orders/${noFileOrder.id}/download`);
  assert.equal(noFileRes.status, 404);
  const noFileData = await noFileRes.json();
  assert.equal(noFileData.error, 'file_not_found');
});

test('POST /api/admin/storage/cleanup frees files from completed orders and clears filePath', async () => {
  const { createOrder, getOrderById } = require('../src/db/database');
  const cleanupFile = path.join(uploadDir, 'cleanup-sample.stl');
  fs.writeFileSync(cleanupFile, 'solid clean\nendsolid clean');
  assert.ok(fs.existsSync(cleanupFile));

  const completedOrder = await createOrder({
    customerName: 'Cleanup Tester',
    fileName: 'cleanup-sample.stl',
    filePath: 'uploads/cleanup-sample.stl',
    volumeMm3: 2000,
    weightG: 2.5,
    dimensions: { x: 15, y: 15, z: 15 },
    quotedPrice: 15.0,
    status: 'Completed',
  });

  const res = await fetch(`${baseURL}/api/admin/storage/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.cleanedCount >= 1);
  assert.ok(data.freedOrders.includes(completedOrder.id));

  // Verify the order in DB has file_path cleared to null
  const updatedOrder = await getOrderById(completedOrder.id);
  assert.equal(updatedOrder.filePath, null);
  // Verify disk copy was unlinked
  assert.equal(fs.existsSync(cleanupFile), false);
});

test('Storage and admin download endpoints enforce admin clearance when token configured', async () => {
  process.env.ADMIN_ACCESS_TOKEN = 'test-token-777';

  try {
    // Without token: 401
    const unauthDownload = await fetch(`${baseURL}/api/admin/orders/1/download`);
    assert.equal(unauthDownload.status, 401);

    const unauthCleanup = await fetch(`${baseURL}/api/admin/storage/cleanup`, {
      method: 'POST',
    });
    assert.equal(unauthCleanup.status, 401);

    // With valid x-admin-token: allowed past auth middleware
    const authCleanup = await fetch(`${baseURL}/api/admin/storage/cleanup`, {
      method: 'POST',
      headers: { 'x-admin-token': 'test-token-777' },
    });
    assert.equal(authCleanup.status, 200);
  } finally {
    delete process.env.ADMIN_ACCESS_TOKEN;
  }
});