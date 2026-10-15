'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILD_VOLUME_LIMIT_MM,
  CURRENCY,
  MATERIAL_RATE_PER_G,
  MACHINE_RATE_PER_HOUR,
  PRINT_GRAMS_PER_HOUR,
  SERVICE_FEE_FLAT,
  MAKING_RATE_PER_G,
  HANDLING_FEE_FLAT,
  MIN_ORDER_VALUE,
  validateBuildVolume,
  calculateWeightGrams,
  calculateMaterialCost,
  calculateMachineHours,
  calculateMachineCost,
  calculateServiceFee,
  calculateMakingCost,
  calculateHandlingFee,
  calculateTotalPrice,
  calculateSlicerMetrics,
  MATERIALS,
  PRINT_PROFILES,
  PLA_RATE_PER_G,
  TPU_RATE_PER_G,
  buildQuote,
} = require('../src/services/quoteCalculator');

test('accepts dimensions exactly at the build limit', () => {
  const result = validateBuildVolume({ x: 180, y: 180, z: 180 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.exceededAxes, []);
});

test('rejects a model exceeding the X axis', () => {
  const result = validateBuildVolume({ x: 185, y: 100, z: 100 });
  assert.equal(result.valid, false);
  assert.equal(result.exceededAxes.length, 1);
  assert.equal(result.exceededAxes[0].axis, 'x');
  assert.equal(result.exceededAxes[0].limit, BUILD_VOLUME_LIMIT_MM);
  assert.equal(result.exceededAxes[0].excess, 5);
});

test('reports every exceeded axis', () => {
  const result = validateBuildVolume({ x: 200, y: 190, z: 181 });
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.exceededAxes.map((entry) => entry.axis),
    ['x', 'y', 'z'],
  );
});

test('accepts a model comfortably within the build limit', () => {
  assert.equal(validateBuildVolume({ x: 20, y: 20, z: 20 }).valid, true);
});

test('calculates PLA+ weight from volume', () => {
  const weight = calculateWeightGrams(15000); // 15000 mm^3
  assert.ok(Math.abs(weight - 18.6) < 1e-9);
});

test('calculates retail material charge at ₹2.00/g', () => {
  assert.equal(MATERIAL_RATE_PER_G, 2.0);
  const cost = calculateMaterialCost(18.6);
  assert.ok(Math.abs(cost - 37.2) < 1e-9);
});

test('estimates machine hours from the 12 g/hour throughput assumption', () => {
  assert.equal(PRINT_GRAMS_PER_HOUR, 12);
  assert.ok(Math.abs(calculateMachineHours(18.6) - 1.55) < 1e-9);
  assert.equal(calculateMachineHours(0), 0);
});

test('charges machine time at ₹25/hour with a ₹39 fixed service fee', () => {
  assert.equal(MACHINE_RATE_PER_HOUR, 25);
  assert.equal(calculateServiceFee(), SERVICE_FEE_FLAT);
  assert.equal(SERVICE_FEE_FLAT, 39);
  assert.ok(Math.abs(calculateMachineCost(1.55) - 38.75) < 1e-9);
});

test('charges print labor at ₹1.00/g with a ₹25 fixed handling fee', () => {
  assert.equal(MAKING_RATE_PER_G, 1.0);
  assert.equal(calculateHandlingFee(), HANDLING_FEE_FLAT);
  assert.equal(HANDLING_FEE_FLAT, 25);
  assert.ok(Math.abs(calculateMakingCost(18.6) - 18.6) < 1e-9);
  assert.equal(calculateMakingCost(0), 0);
});

test('floors tiny prints at the ₹149 minimum order value', () => {
  assert.equal(MIN_ORDER_VALUE, 149);
  // 9.92 g cube: 19.84 + 20.67 + 9.92 + 39 + 25 = 114.43 -> floored at 149.
  const small = calculateTotalPrice({
    materialCost: 19.84,
    machineCost: 20.67,
    makingCost: 9.92,
    serviceFee: 39,
    handlingFee: 25,
  });
  assert.equal(small.subtotal, 114.43);
  assert.equal(small.totalPrice, 149);
  assert.equal(small.minimumApplied, true);
});

test('prices larger prints above the minimum with every fee line', () => {
  // 18.6 g part: 37.20 + 38.75 + 18.60 + 39 + 25 = 158.55 -> ₹159, no minimum.
  const mid = calculateTotalPrice({
    materialCost: 37.2,
    machineCost: 38.75,
    makingCost: 18.6,
    serviceFee: 39,
    handlingFee: 25,
  });
  assert.equal(mid.subtotal, 158.55);
  assert.equal(mid.totalPrice, 159);
  assert.equal(mid.minimumApplied, false);

  // 124 g part: 248.00 + 258.25 + 124.00 + 39 + 25 = 694.25 -> ₹694.
  const big = calculateTotalPrice({
    materialCost: 248,
    machineCost: 258.25,
    makingCost: 124,
    serviceFee: 39,
    handlingFee: 25,
  });
  assert.equal(big.subtotal, 694.25);
  assert.equal(big.totalPrice, 694);
  assert.equal(big.minimumApplied, false);
});

test('buildQuote rounds weight and price to the documented precision', () => {
  const geometry = {
    format: 'ascii',
    triangleCount: 12,
    boundingBox: {
      x: { min: 0, max: 24 },
      y: { min: 0, max: 25 },
      z: { min: 0, max: 25 },
    },
    dimensions: { x: 24, y: 25, z: 25 },
    volumeMm3: 15000.000000001,
  };

  const quote = buildQuote(geometry, { originalname: 'cube.stl', size: 1234 });

  assert.equal(quote.volumeMm3, 15000);
  assert.equal(quote.weightGrams, 18.6);
  assert.equal(quote.materialCost, 37.2);
  assert.equal(quote.machineHours, 1.55);
  assert.equal(quote.machineCost, 38.75);
  assert.equal(quote.makingCost, 18.6);
  assert.equal(quote.serviceFee, 39);
  assert.equal(quote.handlingFee, 25);
  assert.equal(quote.subtotal, 158.55);
  assert.equal(quote.totalPrice, 159);
  assert.equal(quote.minimumApplied, false);
  assert.equal(quote.currency, 'INR');
  assert.equal(CURRENCY, 'INR');
  assert.equal(quote.material.name, 'PLA+');
  assert.equal(quote.withinBuildVolume, true);
});

test('buildQuote prices a large part above the minimum with an itemized total', () => {
  const geometry = {
    format: 'binary',
    triangleCount: 120,
    boundingBox: {
      x: { min: 0, max: 100 },
      y: { min: 0, max: 100 },
      z: { min: 0, max: 10 },
    },
    dimensions: { x: 100, y: 100, z: 10 },
    volumeMm3: 100000,
  };

  const quote = buildQuote(geometry, { originalname: 'bracket.stl', size: 6000 });

  // 124 g: material 248.00 + machine (10.33 h x ₹25) 258.25 + making 124.00 + service 39 + handling 25 = 694.25
  assert.equal(quote.weightGrams, 124);
  assert.equal(quote.materialCost, 248);
  assert.equal(quote.machineHours, 10.33);
  assert.equal(quote.machineCost, 258.25);
  assert.equal(quote.makingCost, 124);
  assert.equal(quote.serviceFee, 39);
  assert.equal(quote.handlingFee, 25);
  assert.equal(quote.subtotal, 694.25);
  assert.equal(quote.totalPrice, 694);
  assert.equal(quote.minimumApplied, false);
});

test('calculateSlicerMetrics evaluates realistic FDM shells, infill, and support volumes', () => {
  // 50 x 50 x 20 mm box: volume = 50,000 mm³ = 50 cm³, surfaceArea = 9,000 mm² = 90 cm²
  // Standard profile: 0.20mm layers, 20% infill, wallThickness = 0.12 cm
  // shellVolume = Math.min(50, 90 * 0.12) = Math.min(50, 10.8) = 10.8 cm³
  // infillVolume = (50 - 10.8) * 0.20 = 39.2 * 0.20 = 7.84 cm³
  // supportVolume = overhangArea (10 cm²) * (height 2 cm * 0.5) * 0.18 = 10 * 1 * 0.18 = 1.8 cm³
  // unitPlasticVolume = 10.8 + 7.84 + 1.8 = 20.44 cm³
  const metrics = calculateSlicerMetrics({
    volumeMm3: 50000,
    surfaceAreaMm2: 9000,
    dimensions: { x: 50, y: 50, z: 20 },
    profile: 'standard',
    material: 'pla',
    overhangAreaMm2: 1000, // 10 cm²
    avgOverhangHeightMm: 10, // 1 cm
    quantity: 1,
  });

  assert.equal(metrics.volumes.totalMeshVolumeCm3, 50);
  assert.equal(metrics.volumes.shellVolumeCm3, 10.8);
  assert.equal(metrics.volumes.infillVolumeCm3, 7.84);
  assert.equal(metrics.volumes.supportVolumeCm3, 1.8);
  assert.equal(metrics.volumes.unitPlasticVolumeCm3, 20.44);
  // Model weight in PLA+ (1.24 g/cm³): (10.8 + 7.84) * 1.24 = 23.114 g
  // Support weight with 1.5g interface allowance: Math.ceil(1.8 * 1.24 + 1.5) = 4 g
  // Total unit weight: 23.114 + 4 = 27.114 g
  assert.equal(metrics.partWeightGrams, 23.114);
  assert.equal(metrics.supportWeightGrams, 4);
  assert.equal(metrics.unitWeightGrams, 27.114);
  assert.equal(metrics.material.retailRatePerG, 2.0);
});

test('calculateSlicerMetrics supports Draft, Standard, and Heavy-Duty profiles', () => {
  const base = {
    volumeMm3: 30000,
    surfaceAreaMm2: 6000,
    dimensions: { x: 30, y: 30, z: 33.33 },
  };

  const draft = calculateSlicerMetrics({ ...base, profile: 'draft', material: 'pla' });
  const standard = calculateSlicerMetrics({ ...base, profile: 'standard', material: 'pla' });
  const heavy = calculateSlicerMetrics({ ...base, profile: 'heavy-duty', material: 'pla' });

  // Draft (10% infill, 0.08cm walls) < Standard (20% infill, 0.12cm walls) < Heavy (45% infill, 0.16cm walls)
  assert.ok(draft.unitWeightGrams < standard.unitWeightGrams);
  assert.ok(standard.unitWeightGrams < heavy.unitWeightGrams);
  assert.equal(draft.profile.layerHeightMm, 0.24);
  assert.equal(standard.profile.layerHeightMm, 0.20);
  assert.equal(heavy.profile.layerHeightMm, 0.16);
  assert.equal(heavy.profile.wallCount, 4);
});

test('calculateSlicerMetrics handles Flexible TPU 95A at ₹3.50/g', () => {
  const tpu = calculateSlicerMetrics({
    volumeMm3: 20000,
    surfaceAreaMm2: 5000,
    dimensions: { x: 20, y: 20, z: 50 },
    profile: 'standard',
    material: 'tpu',
  });

  assert.equal(tpu.material.id, 'tpu');
  assert.equal(tpu.material.name, 'Flexible TPU 95A');
  assert.equal(tpu.material.densityGPerCm3, 1.21);
  assert.equal(tpu.material.retailRatePerG, 3.5);
});

test('calculateSlicerMetrics applies automatic bulk discounts at 5+ and 10+ units', () => {
  const base = {
    volumeMm3: 40000,
    surfaceAreaMm2: 8000,
    profile: 'standard',
    material: 'pla',
  };

  const q1 = calculateSlicerMetrics({ ...base, quantity: 1 });
  const q4 = calculateSlicerMetrics({ ...base, quantity: 4 });
  const q5 = calculateSlicerMetrics({ ...base, quantity: 5 });
  const q10 = calculateSlicerMetrics({ ...base, quantity: 10 });

  assert.equal(q1.discountPercentage, 0);
  assert.equal(q4.discountPercentage, 0);
  assert.equal(q5.discountPercentage, 10);
  assert.equal(q10.discountPercentage, 20);
  assert.ok(q5.discountAmount > 0);
  assert.ok(q10.discountAmount > 0);
  // Per-unit price decreases with bulk volume
  assert.ok(q10.unitPrice < q5.unitPrice);
  assert.ok(q5.unitPrice < q1.unitPrice);
});

test('buildQuote in slicer mode returns detailed volume breakdown', () => {
  const geometry = {
    format: 'binary',
    triangleCount: 500,
    boundingBox: {
      x: { min: 0, max: 40 },
      y: { min: 0, max: 40 },
      z: { min: 0, max: 20 },
    },
    dimensions: { x: 40, y: 40, z: 20 },
    volumeMm3: 32000,
    surfaceAreaMm2: 6400,
  };

  const quote = buildQuote(geometry, { originalname: 'dock.stl', size: 10000 }, {
    profile: 'heavy-duty',
    material: 'tpu',
    quantity: 5,
  });

  assert.equal(quote.profile.id, 'heavy-duty');
  assert.equal(quote.material.id, 'tpu');
  assert.equal(quote.quantity, 5);
  assert.equal(quote.discountPercentage, 10);
  assert.ok(quote.volumes.shellVolumeCm3 > 0);
  assert.ok(quote.volumes.infillVolumeCm3 > 0);
  assert.ok(quote.totalPrice > 0);
});

test('calculateSlicerMetrics strictly increases material weight and cost when infill increases', () => {
  const model = {
    volumeMm3: 40000,
    surfaceAreaMm2: 7500,
    dimensions: { x: 40, y: 40, z: 25 },
    material: 'pla',
  };

  const infill10 = calculateSlicerMetrics({ ...model, infillPercent: 10 });
  const infill20 = calculateSlicerMetrics({ ...model, infillPercent: 20 });
  const infill45 = calculateSlicerMetrics({ ...model, infillPercent: 45 });
  const infill75 = calculateSlicerMetrics({ ...model, infillPercent: 75 });
  const infill100 = calculateSlicerMetrics({ ...model, infillPercent: 100 });

  // Infill volume strictly increases
  assert.ok(infill10.volumes.infillVolumeCm3 < infill20.volumes.infillVolumeCm3);
  assert.ok(infill20.volumes.infillVolumeCm3 < infill45.volumes.infillVolumeCm3);
  assert.ok(infill45.volumes.infillVolumeCm3 < infill75.volumes.infillVolumeCm3);
  assert.ok(infill75.volumes.infillVolumeCm3 < infill100.volumes.infillVolumeCm3);

  // Weight strictly increases as more filament is used
  assert.ok(infill10.unitWeightGrams < infill20.unitWeightGrams);
  assert.ok(infill20.unitWeightGrams < infill45.unitWeightGrams);
  assert.ok(infill45.unitWeightGrams < infill75.unitWeightGrams);
  assert.ok(infill75.unitWeightGrams < infill100.unitWeightGrams);

  // Total cost strictly increases as infill rises
  assert.ok(infill10.totalPrice <= infill20.totalPrice);
  assert.ok(infill20.totalPrice < infill45.totalPrice);
  assert.ok(infill45.totalPrice < infill75.totalPrice);
  assert.ok(infill75.totalPrice < infill100.totalPrice);
});

test('calculateSlicerMetrics strictly increases cost for small prints below minimum order floor as infill increases', () => {
  const tinyModel = {
    volumeMm3: 4000, // tiny part (4 cm³)
    surfaceAreaMm2: 1600,
    dimensions: { x: 15, y: 15, z: 17.7 },
    material: 'pla',
  };

  const tiny10 = calculateSlicerMetrics({ ...tinyModel, infillPercent: 10 });
  const tiny20 = calculateSlicerMetrics({ ...tinyModel, infillPercent: 20 });
  const tiny45 = calculateSlicerMetrics({ ...tinyModel, infillPercent: 45 });
  const tiny80 = calculateSlicerMetrics({ ...tinyModel, infillPercent: 80 });
  const tiny100 = calculateSlicerMetrics({ ...tinyModel, infillPercent: 100 });

  // Standard 20% sits at the base ₹149 minimum
  assert.equal(tiny10.totalPrice, 149);
  assert.equal(tiny20.totalPrice, 149);

  // Higher density parts consume more material and increase price above ₹149
  assert.ok(tiny45.totalPrice > tiny20.totalPrice, `Expected 45% (${tiny45.totalPrice}) > 20% (${tiny20.totalPrice})`);
  assert.ok(tiny80.totalPrice > tiny45.totalPrice, `Expected 80% (${tiny80.totalPrice}) > 45% (${tiny45.totalPrice})`);
  assert.ok(tiny100.totalPrice > tiny80.totalPrice, `Expected 100% (${tiny100.totalPrice}) > 80% (${tiny80.totalPrice})`);
});

