'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

// In-memory test environment
process.env.SNKB_DB_PATH = ':memory:';
process.env.ADMIN_PASSCODE = 'test_secret_spools_pass_123';

const app = require('../src/app');
const { listSpools, updateSpoolRemaining } = require('../src/db/database');

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

test('Spool DB unit tests: listSpools returns default seeded spools', async () => {
  const spools = await listSpools();
  assert.ok(Array.isArray(spools));
  assert.ok(spools.length >= 6);

  const concreteGrey = spools.find((s) => s.color_name === 'Concrete Grey' || s.colorName === 'Concrete Grey');
  assert.ok(concreteGrey);
  assert.equal(concreteGrey.material, 'Tough PLA+');
  assert.equal(typeof concreteGrey.remaining_grams, 'number');
});

test('Spool DB unit tests: updateSpoolRemaining updates spool weight', async () => {
  const spools = await listSpools();
  const firstId = spools[0].id;
  const updated = await updateSpoolRemaining(firstId, 750.5);
  assert.ok(updated);
  assert.equal(updated.remaining_grams, 750.5);

  const reloaded = await listSpools();
  const found = reloaded.find((s) => s.id === firstId);
  assert.equal(found.remaining_grams, 750.5);
});

test('GET /api/spools is public and returns list of filament spools', async () => {
  const res = await fetch(`${baseURL}/api/spools`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.spools));
  assert.ok(data.spools.length >= 6);

  const tpu = data.spools.find((s) => s.material.includes('TPU'));
  assert.ok(tpu);
});

test('GET /api/admin/spools rejects unauthorized requests when ADMIN_PASSCODE is set', async () => {
  const res = await fetch(`${baseURL}/api/admin/spools`);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('GET /api/admin/spools allows requests with valid admin passcode header', async () => {
  const res = await fetch(`${baseURL}/api/admin/spools`, {
    headers: {
      'x-admin-passcode': 'test_secret_spools_pass_123',
    },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.spools));
});

test('PATCH /api/admin/spools/:id updates spool inventory with valid passcode', async () => {
  const spoolsRes = await fetch(`${baseURL}/api/spools`);
  const { spools } = await spoolsRes.json();
  const targetId = spools[0].id;

  const patchRes = await fetch(`${baseURL}/api/admin/spools/${targetId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': 'test_secret_spools_pass_123',
    },
    body: JSON.stringify({ remainingGrams: 320 }),
  });

  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.success, true);
  assert.equal(patchData.spool.remaining_grams, 320);
});

test('PATCH /api/admin/spools/:id rejects negative remainingGrams', async () => {
  const patchRes = await fetch(`${baseURL}/api/admin/spools/spool-pla-grey`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-passcode': 'test_secret_spools_pass_123',
    },
    body: JSON.stringify({ remainingGrams: -50 }),
  });

  assert.equal(patchRes.status, 400);
  const data = await patchRes.json();
  assert.equal(data.success, false);
});
