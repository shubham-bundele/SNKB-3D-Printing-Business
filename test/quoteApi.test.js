'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

// Hermetic, in-memory persistence for the quote API test suite (no writes to
// the development data/ or uploads/ directories).
process.env.SNKB_DB_PATH = ':memory:';
process.env.SNKB_UPLOAD_DIR = path.join(os.tmpdir(), `snkb-quoteapi-uploads-${process.pid}`);

const app = require('../src/app');
const {
  createBinaryBoxStlBuffer,
  createAsciiBoxStlBuffer,
  createBox3mfBuffer,
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
});

async function uploadQuote(buffer, filename = 'model.stl', fieldName = 'file') {
  const form = new FormData();
  form.append(fieldName, new Blob([buffer], { type: 'model/stl' }), filename);
  return fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
}

test('GET /api/health reports ok', async () => {
  const response = await fetch(`${baseURL}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
});

test('POST /api/quote returns an itemized INR quote for a 15000 mm^3 model', async () => {
  const buffer = createAsciiBoxStlBuffer({ x: 24, y: 25, z: 25 }); // 15000 mm^3
  const response = await uploadQuote(buffer);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.volumeMm3, 15000);
  assert.equal(body.weightGrams, 18.6);
  // 18.6 g: material 37.20 + machine 38.75 + making 18.60 + service 39 + handling 25 = 158.55 -> ₹159.
  assert.equal(body.materialCost, 37.2);
  assert.equal(body.machineCost, 38.75);
  assert.equal(body.makingCost, 18.6);
  assert.equal(body.serviceFee, 39);
  assert.equal(body.handlingFee, 25);
  assert.equal(body.totalPrice, 159);
  assert.equal(body.minimumApplied, false);
  assert.equal(body.currency, 'INR');
});

test('POST /api/quote parses binary STL uploads', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 20, y: 20, z: 20 }); // 8000 mm^3
  const response = await uploadQuote(buffer, 'cube.stl');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.file.format, 'binary');
  assert.equal(body.volumeMm3, 8000);
  assert.equal(body.weightGrams, 9.92);
});

test('POST /api/quote accepts an arbitrary form field name', async () => {
  const buffer = createAsciiBoxStlBuffer({ x: 10, y: 10, z: 10 });
  const response = await uploadQuote(buffer, 'cube.stl', 'model');

  assert.equal(response.status, 200);
});

test('POST /api/quote rejects an oversized model with 400', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 200, y: 50, z: 50 });
  const response = await uploadQuote(buffer, 'oversized.stl');

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error, 'build_volume_exceeded');
  assert.deepEqual(
    body.exceededAxes.map((entry) => entry.axis),
    ['x'],
  );
  assert.equal(body.exceededAxes[0].limit, 180);
});

test('POST /api/quote rejects a missing file with 400', async () => {
  const form = new FormData();
  form.append('note', 'no file here');
  const response = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'missing_file');
});

test('POST /api/quote rejects a non-stl extension with 400', async () => {
  const response = await uploadQuote(Buffer.from('hello'), 'notes.txt');
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'invalid_file_type');
});

test('POST /api/quote rejects a malformed STL with 400', async () => {
  const response = await uploadQuote(Buffer.from('solid broken\nendsolid broken'), 'broken.stl');
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'invalid_stl');
});

test('POST /api/quote computes slicer-accurate quotes with profile, material, and quantity', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 40, y: 40, z: 20 }); // 32000 mm^3, 6400 mm^2
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/stl' }), 'box40.stl');
  form.append('profile', 'heavy-duty');
  form.append('material', 'tpu');
  form.append('quantity', '5');

  const response = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.profile.id, 'heavy-duty');
  assert.equal(body.material.id, 'tpu');
  assert.equal(body.quantity, 5);
  assert.equal(body.discountPercentage, 10);
  assert.ok(body.volumes.shellVolumeCm3 > 0);
  assert.ok(body.volumes.infillVolumeCm3 > 0);
});

test('POST /api/quote parses and quotes uploaded .3mf files', async () => {
  const buffer = createBox3mfBuffer({ x: 30, y: 30, z: 30 }); // 27000 mm^3
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/3mf' }), 'cube30.3mf');

  const response = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.file.format, '3mf');
  assert.equal(body.volumeMm3, 27000);
  assert.equal(body.dimensions.x, 30);
  assert.equal(body.dimensions.y, 30);
  assert.equal(body.dimensions.z, 30);
  assert.ok(body.totalPrice >= 149);
});

test('POST /api/quote applies scaleFactor to dimensions and volume', async () => {
  const buffer = createBinaryBoxStlBuffer({ x: 10, y: 10, z: 10 }); // 1000 mm^3
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'model/stl' }), 'tiny10.stl');
  form.append('scalePercent', '200'); // 2x scale: dimensions 20x20x20, volume 8000 mm^3

  const response = await fetch(`${baseURL}/api/quote`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.dimensions.x, 20);
  assert.equal(body.dimensions.y, 20);
  assert.equal(body.dimensions.z, 20);
  assert.equal(body.volumeMm3, 8000);
});

