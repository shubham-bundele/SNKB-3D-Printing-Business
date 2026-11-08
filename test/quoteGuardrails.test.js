'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/utils/pricingEngine.js');
const service = require('../src/services/quoteCalculator.js');
const { getPartNamesForDesign } = require('../src/utils/explodableAssembly.js');
const fdmTextures = require('../src/utils/fdmTextures.js');

const SAMPLE = {
  volumeMm3: 15000,
  surfaceAreaMm2: 6000,
  dimensions: { x: 60, y: 40, z: 30 },
  profile: 'standard',
  material: 'pla',
  infillPercent: 20,
  quantity: 1,
};

test('Zero-model guardrail: empty bed prices to exactly ₹0 (engine)', () => {
  const z = engine.calculateQuote({ ...SAMPLE, hasActiveModel: false });
  assert.equal(z.totalPrice, 0);
  assert.equal(z.totalPriceINR, 0);
  assert.equal(z.partWeightGrams, 0);
  assert.equal(z.supportWeightGrams, 0);
  assert.equal(z.printTimeMinutes, 0);
  assert.equal(z.setupFeeINR, 0);
  assert.equal(z.modelMaterialCostINR, 0);
  assert.equal(z.supportMaterialCostINR, 0);
  assert.equal(z.machineTimeCostINR, 0);
  assert.equal(z.postProcessingAddonsINR, 0);
  assert.equal(z.minimumApplied, false);
  assert.equal(z.emptyQuote, true);
});

test('Zero-model guardrail: zero volume prices to exactly ₹0 (engine)', () => {
  const z = engine.calculateQuote({ ...SAMPLE, volumeMm3: 0, hasActiveModel: true });
  assert.equal(z.totalPrice, 0);
  assert.equal(z.totalPriceINR, 0);
  assert.equal(z.partWeightGrams, 0);
});

test('Zero-model guardrail: backend service mirrors the engine', () => {
  const z = service.calculateSlicerMetrics({ ...SAMPLE, hasActiveModel: false });
  assert.equal(z.totalPrice, 0);
  assert.equal(z.totalPriceINR, 0);
  assert.equal(z.partWeightGrams, 0);
  assert.equal(z.supportWeightGrams, 0);
  assert.equal(z.printTimeMinutes, 0);
  const zb = service.buildQuote(
    { dimensions: { x: 1, y: 1, z: 1 }, volumeMm3: 10, surfaceAreaMm2: 6, format: 'stl', triangleCount: 12 },
    null,
    { profile: 'standard', useSlicer: true, hasActiveModel: false }
  );
  assert.equal(zb.totalPriceINR, 0);
});

test('Itemized INR identity: totalPriceINR equals totalPrice with exact decomposition', () => {
  const q = engine.calculateQuote({ ...SAMPLE, hasActiveModel: true, quantity: 2 });
  assert.equal(q.totalPriceINR, q.totalPrice);
  assert.equal(q.setupFeeINR, q.serviceFee + q.handlingFee);
  assert.equal(q.modelMaterialCostINR, q.partMaterialCost);
  assert.equal(q.supportMaterialCostINR, q.supportMaterialCost);
  assert.equal(q.machineTimeCostINR, q.unitMachineCost);
  assert.equal(q.makingCostINR, q.unitMakingCost);
  assert.equal(q.postProcessingAddonsINR, q.addOns.total);
  assert.equal(q.printTimeMinutes, Math.round(q.unitMachineHours * 60));
  // Recomposed identity: unit lines x qty + setup - discount + addons, floored.
  const recomposed = Math.round(
    (q.modelMaterialCostINR + q.supportMaterialCostINR + q.machineTimeCostINR + q.makingCostINR) * q.quantity +
      q.setupFeeINR -
      q.discountAmount +
      q.postProcessingAddonsINR
  );
  const floor = Math.round(149 * (1 + Math.max(0, q.infillRatio - 0.2) * 0.6));
  assert.equal(q.totalPrice, Math.max(floor, recomposed));
});

test('exceedsBuildVolume flags any axis above 180mm', () => {
  assert.equal(engine.exceedsBuildVolume({ x: 200, y: 10, z: 10 }), true);
  assert.equal(engine.exceedsBuildVolume({ x: 10, y: 10, z: 181 }), true);
  assert.equal(engine.exceedsBuildVolume({ x: 180, y: 180, z: 180 }), false);
  assert.equal(engine.exceedsBuildVolume(null), false);
});

test('Auto-brim reads z as vertical height — flat parts never falsely brim', () => {
  // Long flat plate: 30mm tall on a 152×81mm footprint (z = height axis).
  // The old bug read y (depth) as height and flagged it tall-aspect.
  const flat = engine.calculateQuote({
    ...SAMPLE,
    volumeMm3: 100000,
    surfaceAreaMm2: 50000,
    dimensions: { x: 152, y: 81, z: 30 },
    hasActiveModel: true,
  });
  assert.equal(flat.autoBrim, false, 'flat plate must not trigger auto-brim');
  assert.equal(flat.brimWeightGrams, 0);

  // A genuinely tall nub: 140mm skyscraper on a 40×40mm base (ratio 3.5).
  const tall = engine.calculateQuote({
    ...SAMPLE,
    volumeMm3: 20000,
    surfaceAreaMm2: 48000,
    dimensions: { x: 40, y: 40, z: 140 },
    hasActiveModel: true,
  });
  assert.equal(tall.autoBrim, true, 'tall-aspect part must trigger auto-brim');
  assert.equal(tall.brimWeightGrams, engine.BRIM_WEIGHT_G);
});

test('Physical part names resolve per design with honest fallback', () => {
  const esp32 = getPartNamesForDesign('esp32-wled-controller-case.stl');
  assert.equal(esp32.base, 'Base Tub + PCB Standoffs');
  assert.equal(esp32.accent, 'Vented Top Lid');
  const mecha = getPartNamesForDesign('Posable Snap-Fit Mecha');
  assert.equal(mecha.base, 'Inner Ball-Joint Skeleton');
  assert.equal(mecha.accent, 'Snap-On Armor Plates');
  const unknown = getPartNamesForDesign('mystery-widget.stl');
  assert.equal(unknown.base, 'Base Plate Assembly');
  assert.equal(unknown.accent, 'Accent Plate Assembly');
});

test('FDM bump texture degrades gracefully without DOM', () => {
  // Node has no document: helper must return null, materials stay valid.
  assert.equal(fdmTextures.createFDMLayerBumpTexture(), null);
  const mat = fdmTextures.physicalFilamentMaterial('#FF6500');
  assert.equal(mat.bumpMap, null);
  assert.equal(mat.roughness, 0.28);
});
