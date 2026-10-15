'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory test environment
process.env.SNKB_DB_PATH = ':memory:';

const app = require('../src/app');

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

test('POST /api/quote/share validates required fields', async () => {
  const res = await fetch(`${baseURL}/api/quote/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('POST /api/quote/share creates a shareable draft quote and returns permalink', async () => {
  const quotePayload = {
    fileName: 'robot_bracket_v2.stl',
    material: 'pla',
    color: 'Matte Dark Grey',
    profile: 'heavy-duty',
    quantity: 5,
    scale: 100,
    dimensions: { x: 50, y: 40, z: 30 },
    weightGrams: 42.5,
    totalPrice: 285,
    breakdown: {
      volumes: { shellVolumeCm3: 12, infillVolumeCm3: 20 },
    },
    addOns: {
      buildPlateTexture: 'carbon_fiber',
      heatSetInserts: 4,
      supportSanding: true,
    },
  };

  const res = await fetch(`${baseURL}/api/quote/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quotePayload),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.shareId);
  assert.equal(data.shareUrl, `/quote/${data.shareId}`);
  assert.equal(data.quote.fileName, 'robot_bracket_v2.stl');
  assert.equal(data.quote.totalPrice, 285);
  assert.equal(data.quote.addOns.heatSetInserts, 4);

  // Verify GET /api/quote/:id retrieves the saved draft
  const getRes = await fetch(`${baseURL}/api/quote/${data.shareId}`);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.success, true);
  assert.equal(getData.quote.shareId, data.shareId);
  assert.equal(getData.quote.material, 'pla');
  assert.equal(getData.quote.quantity, 5);
  assert.equal(getData.quote.addOns.buildPlateTexture, 'carbon_fiber');
});

test('GET /api/quote/:id returns 404 for non-existent quote id', async () => {
  const res = await fetch(`${baseURL}/api/quote/non-existent-share-id-999`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.equal(data.error, 'not_found');
});
