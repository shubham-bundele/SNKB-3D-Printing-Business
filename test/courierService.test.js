'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PICKUP_PIN,
  isCourierConfigured,
  getActiveProvider,
  getCourierEstimate,
} = require('../src/services/courierService');

test('Courier Service - Default unconfigured behavior', async () => {
  const origShipToken = process.env.SHIPROCKET_TOKEN;
  const origShipEmail = process.env.SHIPROCKET_EMAIL;
  const origShipPass = process.env.SHIPROCKET_PASSWORD;
  const origDelhToken = process.env.DELHIVERY_API_TOKEN;

  delete process.env.SHIPROCKET_TOKEN;
  delete process.env.SHIPROCKET_EMAIL;
  delete process.env.SHIPROCKET_PASSWORD;
  delete process.env.DELHIVERY_API_TOKEN;

  try {
    assert.equal(isCourierConfigured(), false);
    assert.equal(getActiveProvider(), 'pending_dispatch');

    const estimate = await getCourierEstimate({ deliveryPin: '450221', weightG: 150 });
    assert.equal(estimate.configured, false);
    assert.equal(estimate.provider, 'pending_dispatch');
    assert.equal(estimate.charge, 99);
    assert.equal(estimate.message, 'Flat ₹99 Pan-India Delivery via Delhivery / Blue Dart');
    assert.deepEqual(estimate.carriers, ['Delhivery', 'Blue Dart']);
  } finally {
    if (origShipToken) process.env.SHIPROCKET_TOKEN = origShipToken;
    if (origShipEmail) process.env.SHIPROCKET_EMAIL = origShipEmail;
    if (origShipPass) process.env.SHIPROCKET_PASSWORD = origShipPass;
    if (origDelhToken) process.env.DELHIVERY_API_TOKEN = origDelhToken;
  }
});

test('Courier Service - Provider detection with env credentials', () => {
  const origShipEmail = process.env.SHIPROCKET_EMAIL;
  const origShipPass = process.env.SHIPROCKET_PASSWORD;
  const origDelhToken = process.env.DELHIVERY_API_TOKEN;

  try {
    // Shiprocket detection
    process.env.SHIPROCKET_EMAIL = 'partner@snkb3d.com';
    process.env.SHIPROCKET_PASSWORD = 'password123';
    delete process.env.DELHIVERY_API_TOKEN;

    assert.equal(isCourierConfigured(), true);
    assert.equal(getActiveProvider(), 'shiprocket');

    // Delhivery detection
    delete process.env.SHIPROCKET_EMAIL;
    delete process.env.SHIPROCKET_PASSWORD;
    process.env.DELHIVERY_API_TOKEN = 'delh_test_token_123';

    assert.equal(isCourierConfigured(), true);
    assert.equal(getActiveProvider(), 'delhivery');
  } finally {
    if (origShipEmail) process.env.SHIPROCKET_EMAIL = origShipEmail; else delete process.env.SHIPROCKET_EMAIL;
    if (origShipPass) process.env.SHIPROCKET_PASSWORD = origShipPass; else delete process.env.SHIPROCKET_PASSWORD;
    if (origDelhToken) process.env.DELHIVERY_API_TOKEN = origDelhToken; else delete process.env.DELHIVERY_API_TOKEN;
  }
});

test('Courier Service - Default pickup PIN', () => {
  assert.ok(DEFAULT_PICKUP_PIN);
  assert.equal(typeof DEFAULT_PICKUP_PIN, 'string');
  assert.equal(DEFAULT_PICKUP_PIN.length, 6);
});
