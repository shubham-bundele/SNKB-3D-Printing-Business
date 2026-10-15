'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const runId = `track-${process.pid}-${Date.now()}`;
const dbPath = path.join(os.tmpdir(), `snkb-track-${runId}.sqlite`);
const uploadDir = path.join(os.tmpdir(), `snkb-track-uploads-${runId}`);

process.env.SNKB_DB_PATH = dbPath;
process.env.SNKB_UPLOAD_DIR = uploadDir;
// Keep this unit suite hermetic: don't reach out to Ethereal during confirms.
process.env.SNKB_EMAIL_ENABLED = '0';

const app = require('../src/app');
const { createOrder } = require('../src/db/database');
const { createBinaryBoxStlBuffer } = require('./helpers/stlGenerator');

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

test('POST /api/orders/confirm - validation checks', async () => {
  // 1. Missing orderId
  const res1 = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName: 'Test', email: 'test@example.com' }),
  });
  assert.equal(res1.status, 400);
  const data1 = await res1.json();
  assert.equal(data1.error, 'invalid_order_id');

  // 2. Missing customerName
  const res2 = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 999, customerName: '', email: 'test@example.com' }),
  });
  assert.equal(res2.status, 400);
  const data2 = await res2.json();
  assert.equal(data2.error, 'missing_customer_name');

  // 3. Invalid email
  const res3 = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 999, customerName: 'Alex', email: 'not-an-email' }),
  });
  assert.equal(res3.status, 400);
  const data3 = await res3.json();
  assert.equal(data3.error, 'invalid_email');

  // 4. Non-existent order
  const res4 = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 987654, customerName: 'Alex', email: 'alex@example.com' }),
  });
  assert.equal(res4.status, 404);
  const data4 = await res4.json();
  assert.equal(data4.error, 'not_found');
});

test('POST /api/quote -> POST /api/orders/confirm -> GET /api/orders/:id full flow', async () => {
  // 1. Upload quote via /api/quote
  const buffer = createBinaryBoxStlBuffer({ x: 30, y: 30, z: 20 });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/stl' }), 'bracket.stl');

  const quoteRes = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  assert.equal(quoteRes.status, 200);
  const quoteData = await quoteRes.json();
  assert.ok(quoteData.orderId, 'quote should generate an orderId');

  const orderId = quoteData.orderId;

  // 2. Confirm order via POST /api/orders/confirm
  const confirmRes = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      customerName: 'Morgan Stanley',
      email: 'morgan.stanley@example.com',
      color: 'Dark Gray',
      notes: '20% gyroid infill',
    }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmData = await confirmRes.json();
  assert.equal(confirmData.success, true);
  assert.equal(confirmData.orderId, orderId);
  assert.equal(confirmData.order.customerName, 'Morgan Stanley');
  assert.equal(confirmData.order.customerEmail, 'morgan.stanley@example.com');
  assert.equal(confirmData.order.color, 'Dark Gray');
  assert.equal(confirmData.order.notes, '20% gyroid infill');
  // Security check: filePath must not be exposed in public order object
  assert.equal(confirmData.order.filePath, undefined);

  // 3. Query public tracking via GET /api/orders/:id
  const trackRes = await fetch(`${baseURL}/api/orders/${orderId}`);
  assert.equal(trackRes.status, 200);
  const trackData = await trackRes.json();
  assert.equal(trackData.success, true);
  assert.equal(trackData.order.id, orderId);
  assert.equal(trackData.order.customerName, 'Morgan Stanley');
  assert.equal(trackData.order.customerEmail, 'morgan.stanley@example.com');
  assert.equal(trackData.order.color, 'Dark Gray');
  assert.equal(trackData.order.notes, '20% gyroid infill');
  assert.equal(trackData.order.filePath, undefined, 'public tracking must sanitize filePath');
  assert.equal(trackData.order.status, 'Pending');
});

test('GET /api/orders/:id - returns 404 for non-existent or invalid id', async () => {
  const res1 = await fetch(`${baseURL}/api/orders/999999`);
  assert.equal(res1.status, 404);
  const data1 = await res1.json();
  assert.equal(data1.error, 'not_found');

  const res2 = await fetch(`${baseURL}/api/orders/invalid-id`);
  assert.equal(res2.status, 404);
  const data2 = await res2.json();
  assert.equal(data2.error, 'not_found');
});

test('GET /api/orders/delivery quotes courier charges from stored order metrics', async () => {
  // 30x30x20 mm bracket: 18000 mm^3 -> 22.32 g, print total ₹160 (below ₹499).
  const buffer = createBinaryBoxStlBuffer({ x: 30, y: 30, z: 20 });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/stl' }), 'bracket.stl');
  const quoteRes = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  assert.equal(quoteRes.status, 200);
  const quoteData = await quoteRes.json();

  // Metro Delhi: parcel 172.32 g -> flat ₹99 standard customer delivery.
  const res = await fetch(
    `${baseURL}/api/orders/delivery?orderId=${quoteData.orderId}&pincode=110001`
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.delivery.pincode, '110001');
  assert.equal(data.delivery.zone, 'metro');
  assert.equal(data.delivery.deliveryCharge, 99);
  assert.equal(data.delivery.freeShipping, false);
  assert.equal(data.delivery.grandTotal, quoteData.totalPrice + 99);

  // Bad pincode -> 400, unknown order -> 404.
  const badPin = await fetch(
    `${baseURL}/api/orders/delivery?orderId=${quoteData.orderId}&pincode=12`
  );
  assert.equal(badPin.status, 400);
  assert.equal((await badPin.json()).error, 'invalid_pincode');

  const noOrder = await fetch(`${baseURL}/api/orders/delivery?orderId=987654&pincode=110001`);
  assert.equal(noOrder.status, 404);
});

test('POST /api/orders/confirm settles delivery + grand total when pincode given', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 30, y: 30, z: 20 });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/stl' }), 'bracket.stl');
  const quoteRes = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  const quoteData = await quoteRes.json();

  const confirmRes = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: quoteData.orderId,
      customerName: 'Priya Nair',
      email: 'priya.nair@example.com',
      pincode: '400001',
    }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmData = await confirmRes.json();
  assert.equal(confirmData.success, true);
  assert.equal(confirmData.order.deliveryPincode, '400001');
  assert.equal(confirmData.order.deliveryZone, 'metro');
  assert.equal(confirmData.order.deliveryCharge, 99);
  assert.equal(confirmData.order.grandTotal, quoteData.totalPrice + 99);

  // Tracking exposes the settled delivery rows (and still hides filePath).
  const trackRes = await fetch(`${baseURL}/api/orders/${quoteData.orderId}`);
  const trackData = await trackRes.json();
  assert.equal(trackData.order.deliveryCharge, 99);
  assert.equal(trackData.order.grandTotal, quoteData.totalPrice + 99);
  assert.equal(trackData.order.filePath, undefined);
});

test('POST /api/orders/confirm rejects an invalid delivery pincode', async () => {
  const created = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  const res = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created.id,
      customerName: 'Ravi',
      email: 'ravi@example.com',
      pincode: 'not-a-pin',
    }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_pincode');
});

test('POST /api/orders/confirm without pincode leaves delivery unset', async () => {
  const created = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  const res = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created.id,
      customerName: 'Ravi',
      email: 'ravi@example.com',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.order.deliveryCharge, null);
  assert.equal(data.order.grandTotal, null);
});

test('POST /api/orders/confirm persists COD payment mode', async () => {
  const created = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  const res = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created.id,
      customerName: 'Sneha',
      email: 'sneha@example.com',
      paymentMode: 'COD',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.order.paymentMode, 'COD');

  const trackRes = await fetch(`${baseURL}/api/orders/${created.id}`);
  assert.equal((await trackRes.json()).order.paymentMode, 'COD');
});

test('POST /api/orders/confirm defaults to Prepaid and rejects bad modes', async () => {
  const created = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  const res = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created.id,
      customerName: 'Arjun',
      email: 'arjun@example.com',
    }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).order.paymentMode, 'Prepaid');

  const created2 = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  const bad = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created2.id,
      customerName: 'Arjun',
      email: 'arjun@example.com',
      paymentMode: 'Bitcoin',
    }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_payment_mode');
});

test('POST /api/orders/confirm persists paymentUtr and updates via /api/orders/:id/utr', async () => {
  const created = await createOrder({ customerName: 'Guest', quotedPrice: 149 });
  
  // 1. Confirm with paymentUtr
  const res = await fetch(`${baseURL}/api/orders/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: created.id,
      customerName: 'Rohit Sharma',
      email: 'rohit@example.com',
      paymentMode: 'Prepaid',
      paymentUtr: '428812345678',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.order.paymentUtr, '428812345678');

  // Verify fetch returns paymentUtr
  const trackRes = await fetch(`${baseURL}/api/orders/${created.id}`);
  assert.equal((await trackRes.json()).order.paymentUtr, '428812345678');

  // 2. Update UTR via POST /api/orders/:id/utr
  const updateRes = await fetch(`${baseURL}/api/orders/${created.id}/utr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utr: '428887654321' }),
  });
  assert.equal(updateRes.status, 200);
  const updateData = await updateRes.json();
  assert.equal(updateData.success, true);
  assert.equal(updateData.utr, '428887654321');
  assert.equal(updateData.order.paymentUtr, '428887654321');

  // 3. Validation errors on /utr endpoint
  const missingRes = await fetch(`${baseURL}/api/orders/${created.id}/utr`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utr: '' }),
  });
  assert.equal(missingRes.status, 400);
  assert.equal((await missingRes.json()).error, 'missing_utr');

  const notFoundRes = await fetch(`${baseURL}/api/orders/999999/utr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ utr: '123456789012' }),
  });
  assert.equal(notFoundRes.status, 404);
  assert.equal((await notFoundRes.json()).error, 'not_found');
});
