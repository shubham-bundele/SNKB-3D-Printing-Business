'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PACKAGING_GRAMS,
  BASE_500G,
  EXTRA_500G,
  FREE_SHIPPING_THRESHOLD,
  isValidPincode,
  normalizePincode,
  zoneForPincode,
  volumetricWeightG,
  chargeableWeightG,
  slabCharge,
  calculateDelivery,
} = require('../src/services/deliveryCalculator');

test('accepts well-formed 6-digit PINs and rejects the rest', () => {
  assert.equal(isValidPincode('110001'), true); // New Delhi
  assert.equal(isValidPincode('400001'), true); // Mumbai
  assert.equal(isValidPincode('560001'), true); // Bengaluru
  assert.equal(isValidPincode(' 110001 '), true); // surrounding whitespace ok
  assert.equal(isValidPincode('123'), false);
  assert.equal(isValidPincode('012345'), false); // no Indian PIN starts with 0
  assert.equal(isValidPincode('abcdef'), false);
  assert.equal(isValidPincode(''), false);
  assert.equal(isValidPincode(null), false);
  assert.equal(isValidPincode(undefined), false);
  assert.equal(normalizePincode(' 400001 '), '400001');
  assert.equal(normalizePincode('12'), null);
});

test('routes hub prefixes to the metro zone, everything else regional', () => {
  assert.equal(zoneForPincode('110001'), 'metro');
  assert.equal(zoneForPincode('400001'), 'metro');
  assert.equal(zoneForPincode('560001'), 'metro');
  assert.equal(zoneForPincode('600001'), 'metro');
  assert.equal(zoneForPincode('700001'), 'metro');
  assert.equal(zoneForPincode('500001'), 'metro');
  assert.equal(zoneForPincode('243001'), 'regional'); // Bareilly, UP
  assert.equal(zoneForPincode('831001'), 'regional'); // Ranchi
  assert.equal(zoneForPincode('999999'), 'regional');
});

test('volumetric weight follows LxWxH/5000 with mm inputs', () => {
  // 20x20x20 mm cube -> 8000/5000 = 1.6 g (negligible vs parcel weight).
  assert.ok(Math.abs(volumetricWeightG({ x: 20, y: 20, z: 20 }) - 1.6) < 1e-9);
  // 180 mm cube -> 5,832,000/5000 = 1166.4 g (dominates a light print).
  assert.ok(Math.abs(volumetricWeightG({ x: 180, y: 180, z: 180 }) - 1166.4) < 1e-9);
  assert.equal(volumetricWeightG(null), 0);
  assert.equal(volumetricWeightG({ x: 0, y: 10, z: 10 }), 0);
});

test('chargeable weight adds the 150 g packaging buffer first', () => {
  assert.equal(PACKAGING_GRAMS, 150);
  // 9.92 g cube in a 20 mm box: parcel 159.92 g beats volumetric 1.6 g.
  assert.ok(Math.abs(chargeableWeightG(9.92, { x: 20, y: 20, z: 20 }) - 159.9) < 1e-9);
  // Big light shell: volumetric 1166.4 g beats the parcel weight.
  assert.ok(
    Math.abs(chargeableWeightG(50, { x: 180, y: 180, z: 180 }) - 1166.4) < 1e-9
  );
});

test('slab math: base covers 500 g, extras stack per 500 g', () => {
  assert.equal(slabCharge(1, 'metro'), BASE_500G.metro);
  assert.equal(slabCharge(500, 'metro'), BASE_500G.metro);
  assert.equal(slabCharge(500.1, 'metro'), BASE_500G.metro + EXTRA_500G.metro);
  assert.equal(slabCharge(1000, 'metro'), BASE_500G.metro + EXTRA_500G.metro);
  assert.equal(slabCharge(1000.1, 'metro'), BASE_500G.metro + 2 * EXTRA_500G.metro);
  assert.equal(slabCharge(300, 'regional'), BASE_500G.regional);
  assert.equal(slabCharge(1166.4, 'regional'), BASE_500G.regional + 2 * EXTRA_500G.regional);
});

test('Delhi metro quote for the 20 mm sample cube charges flat ₹99 (totals ₹248)', () => {
  const d = calculateDelivery({
    weightG: 9.92,
    dimensionsMm: { x: 20, y: 20, z: 20 },
    pincode: '110001',
    orderValue: 149,
  });
  assert.equal(d.pincode, '110001');
  assert.equal(d.zone, 'metro');
  assert.equal(d.chargeableWeightG, 159.9);
  assert.equal(d.rawCourierCost, 59);
  assert.equal(d.deliveryCharge, 99);
  assert.equal(d.profitMargin, 40); // ₹99 customer fee - ₹59 courier cost = ₹40 profit
  assert.equal(d.freeShipping, false);
  assert.equal(d.grandTotal, 248);
});

test('flat 99 base delivery applies to standard parcels, scaling to ₹149 and ₹199 when courier cost exceeds thresholds', () => {
  const metro = calculateDelivery({
    weightG: 9.92,
    dimensionsMm: { x: 20, y: 20, z: 20 },
    pincode: '110001',
    orderValue: 149,
  });
  const regional = calculateDelivery({
    weightG: 9.92,
    dimensionsMm: { x: 20, y: 20, z: 20 },
    pincode: '243001',
    orderValue: 149,
  });
  assert.equal(regional.zone, 'regional');
  assert.ok(regional.rawCourierCost > metro.rawCourierCost);
  // Both standard parcels fall in the flat ₹99 customer tier
  assert.equal(metro.deliveryCharge, 99);
  assert.equal(regional.deliveryCharge, 99);

  // Tier 2: when courier cost exceeds ₹99 (e.g. ₹115), customer is charged ₹149
  const tier2 = calculateDelivery({
    weightG: 9.92,
    dimensionsMm: { x: 20, y: 20, z: 20 },
    pincode: '110001',
    orderValue: 149,
    rawCourierCost: 115,
  });
  assert.equal(tier2.deliveryCharge, 149);
  assert.equal(tier2.grandTotal, 298);

  // Tier 3: when courier cost exceeds ₹149 (e.g. ₹165), customer is charged ₹199
  const tier3 = calculateDelivery({
    weightG: 9.92,
    dimensionsMm: { x: 20, y: 20, z: 20 },
    pincode: '110001',
    orderValue: 149,
    rawCourierCost: 165,
  });
  assert.equal(tier3.deliveryCharge, 199);
  assert.equal(tier3.grandTotal, 348);
});

test('orders at or above ₹499 ship free', () => {
  assert.equal(FREE_SHIPPING_THRESHOLD, 499);
  const d = calculateDelivery({
    weightG: 124,
    dimensionsMm: { x: 100, y: 100, z: 10 },
    pincode: '243001',
    orderValue: 659,
  });
  assert.equal(d.freeShipping, true);
  assert.equal(d.deliveryCharge, 0);
  assert.equal(d.grandTotal, 659);
  // Just below the threshold still pays.
  const paid = calculateDelivery({
    weightG: 124,
    dimensionsMm: { x: 100, y: 100, z: 10 },
    pincode: '243001',
    orderValue: 498,
  });
  assert.equal(paid.freeShipping, false);
  assert.ok(paid.deliveryCharge > 0);
});

test('invalid pincodes throw with code invalid_pincode', () => {
  for (const bad of ['123', '012345', '', null, undefined, 'abcdef']) {
    assert.throws(() => calculateDelivery({ weightG: 10, pincode: bad }), (err) => {
      assert.equal(err.code, 'invalid_pincode');
      return true;
    });
  }
});
