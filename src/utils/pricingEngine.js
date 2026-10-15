/**
 * src/utils/pricingEngine.js
 *
 * Single source of truth for SNKB 3D Studio FDM quoting.
 * Separates Model Filament vs Support Filament explicitly.
 *
 * Formulas (per System Synchronization spec):
 *   Part Weight:
 *     shellVolumeCm3 = min(totalVolumeCm3, surfaceAreaCm2 * wallThicknessCm)
 *     infillVolumeCm3 = max(0, totalVolumeCm3 - shellVolumeCm3) * infillRatio
 *     partWeightGrams = (shellVolumeCm3 + infillVolumeCm3) * density
 *
 *   Support Material Weight (slicer-accurate, per-triangle):
 *     projectedAreaMm2 = areaMm2 * |normalY|   (horizontal projection)
 *     supportVolumeCm3 = (sum(projectedArea * dropHeightMm) / 1000) * 0.18
 *     supportWeightGrams = supportsEnabled
 *       ? ceil(supportVolumeCm3 * density + (supportVolumeCm3 > 0 ? 1.5 : 0))
 *       : 0
 *     (+1.5g support interface / brim allowance; 0g when overhangs < 5% =
 *      print-in-place / no supports needed)
 *
 * Material constants:
 *   Tough PLA+      rho 1.24 g/cm3, Rs 2.00/g, speed 1.00x
 *   PETG/Industrial rho 1.27 g/cm3, Rs 2.50/g, speed 0.85x
 *   Flexible TPU    rho 1.21 g/cm3, Rs 3.50/g, speed 0.55x
 *
 * Dual-consumed: ESM `import` in browser (Vite/Astro) and CJS `require`
 * on the Node backend (Node 22+ supports require(esm)).
 */

'use strict';

export const OVERHANG_THRESHOLD_COS = Math.SQRT1_2; // cos(45deg) ~= 0.7071
export const OVERHANG_MIN_HEIGHT_MM = 0.8;
export const SUPPORT_DENSITY_FACTOR = 0.18;
export const SUPPORT_INTERFACE_ALLOWANCE_G = 1.5;
export const SUPPORT_GRID_MM = 6;
export const PRINT_IN_PLACE_FRACTION = 0.05;
// A1 Mini single-extruder build envelope (mm per axis)
export const BUILD_VOLUME_LIMIT_MM = 180;
// Thin-wall + bedslinger guardrails (A1 Mini single-extruder physics)
export const SHELL_VOLUME_CAP_FRACTION = 0.92;
export const THIN_WALL_SOLID_FRACTION = 0.82;
export const BRIM_WEIGHT_G = 1.5;
export const BRIM_MIN_HEIGHT_MM = 55;
export const BRIM_ASPECT_RATIO = 2.4;
export const BRIM_CLEAR_RATIO = 2.0;
export const LAYER_SWAP_FEE_INR = 30;
export const TPU_MIN_LAYER_MM = 0.16;
export const TPU_MAX_LAYER_MM = 0.24;

export const MATERIALS = {
  pla: {
    id: 'pla',
    name: 'Tough PLA+',
    densityGPerCm3: 1.24,
    retailRatePerG: 2.0,
    speedFactor: 1.0,
    baseThroughputGPerHour: 12,
  },
  petg: {
    id: 'petg',
    name: 'PETG / Industrial',
    densityGPerCm3: 1.27,
    retailRatePerG: 2.5,
    speedFactor: 0.85,
    baseThroughputGPerHour: 12,
  },
  tpu: {
    id: 'tpu',
    name: 'Flexible TPU 95A',
    densityGPerCm3: 1.21,
    retailRatePerG: 3.5,
    speedFactor: 0.55,
    baseThroughputGPerHour: 12,
  },
};

export const PRINT_PROFILES = {
  draft: {
    id: 'draft',
    name: 'Draft (0.24mm / 10% Infill)',
    layerHeightMm: 0.24,
    infillPercentage: 0.1,
    wallCount: 2,
    wallThicknessCm: 0.08,
    speedFactor: 1.3,
  },
  standard: {
    id: 'standard',
    name: 'Standard (0.20mm / 20% Infill)',
    layerHeightMm: 0.2,
    infillPercentage: 0.2,
    wallCount: 3,
    wallThicknessCm: 0.12,
    speedFactor: 1.0,
  },
  'heavy-duty': {
    id: 'heavy-duty',
    name: 'Heavy-Duty Structural (0.16mm / 45% Infill, 4 Walls)',
    layerHeightMm: 0.16,
    infillPercentage: 0.45,
    wallCount: 4,
    wallThicknessCm: 0.16,
    speedFactor: 0.75,
  },
};
PRINT_PROFILES.heavyDuty = PRINT_PROFILES['heavy-duty'];

export function normalizeMaterial(material) {
  const key = String(material || 'pla').toLowerCase();
  if (key.includes('petg') || key === 'petg') return MATERIALS.petg;
  if (key.includes('tpu')) return MATERIALS.tpu;
  return MATERIALS.pla;
}

export function normalizeProfile(profile) {
  const key = String(profile || 'standard').toLowerCase().replace(/_/g, '-');
  return PRINT_PROFILES[key] || PRINT_PROFILES.standard;
}

export function normalizeInfillRatio(infillPercent, fallback) {
  if (typeof infillPercent === 'number' && infillPercent > 0) {
    const r = infillPercent > 1 ? infillPercent / 100 : infillPercent;
    return Math.min(1.0, Math.max(0.05, r));
  }
  return fallback;
}

export function roundNum(val, dec = 2) {
  const factor = 10 ** dec;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/** Part (model-only) filament weight, no supports.
 * Thin-wall volume conservation: perimeter walls can never exceed total solid volume.
 * shellVolumeCm3 = min(totalVolumeCm3 * 0.92, surfaceAreaCm2 * wallThicknessCm)
 */
export function computePartWeight({ totalVolumeCm3, surfaceAreaCm2, wallThicknessCm, infillRatio, density }) {
  const shellVolumeCm3 = Math.min(totalVolumeCm3 * SHELL_VOLUME_CAP_FRACTION, surfaceAreaCm2 * wallThicknessCm);
  const infillVolumeCm3 = Math.max(0, totalVolumeCm3 - shellVolumeCm3) * infillRatio;
  const partWeightGrams = (shellVolumeCm3 + infillVolumeCm3) * density;
  return { shellVolumeCm3, infillVolumeCm3, partWeightGrams };
}

/** True when perimeter shells fill almost the entire interior (infill % barely matters). */
export function isThinWalledPart({ shellVolumeCm3, totalVolumeCm3 }) {
  if (!totalVolumeCm3 || totalVolumeCm3 <= 0) return false;
  return shellVolumeCm3 >= totalVolumeCm3 * THIN_WALL_SOLID_FRACTION;
}

/**
 * A1 Mini bedslinger stability: tall/narrow parts need an 8mm auto-brim (+1.5g).
 * size = { x, y, z } in mm where y is vertical build height in the viewer frame.
 * baseAreaMm2 = contact area within 0.4mm of Y=0 (optional; ratio check suffices).
 */
export function detectAutoBrim({ size, baseAreaMm2 = null } = {}) {
  if (!size) return { needsBrim: false, reason: null, brimWeightG: 0 };
  let heightMm, widthMm, depthMm;
  if (size.heightMm != null) {
    heightMm = Number(size.heightMm);
    widthMm = Number(size.widthMm ?? size.x ?? 0);
    depthMm = Number(size.depthMm ?? size.z ?? size.y ?? 0);
  } else {
    heightMm = Number(size.y ?? 0);
    widthMm = Number(size.x ?? 0);
    depthMm = Number(size.z ?? 0);
  }
  if (!(heightMm > 0)) return { needsBrim: false, reason: null, brimWeightG: 0 };
  const footprint = Math.min(widthMm, depthMm);
  if (!footprint || footprint <= 0) return { needsBrim: false, reason: null, brimWeightG: 0 };
  const ratio = heightMm / footprint;
  if (heightMm > BRIM_MIN_HEIGHT_MM && ratio > BRIM_ASPECT_RATIO) {
    return { needsBrim: true, reason: 'tall-aspect', ratio, brimWeightG: BRIM_WEIGHT_G };
  }
  return { needsBrim: false, reason: null, ratio, brimWeightG: 0 };
}

/** TPU 95A requires 0.16-0.24mm layers on a 0.4mm nozzle; finer layers jam. */
export function clampLayerHeightForMaterial(layerHeightMm, material) {
  const mat = normalizeMaterial(material);
  if (mat.id === 'tpu') {
    const v = Number(layerHeightMm);
    if (!(v > 0)) return 0.2;
    return Math.min(TPU_MAX_LAYER_MM, Math.max(TPU_MIN_LAYER_MM, v));
  }
  return layerHeightMm;
}

/**
 * Strict 180 x 180 x 180 mm build-volume check (Bambu Lab A1 Mini envelope).
 * Any single axis above the limit blocks checkout until auto-scaled.
 */
export function exceedsBuildVolume(dimensions, limit = BUILD_VOLUME_LIMIT_MM) {
  if (!dimensions) return false;
  const lim = Number(limit) > 0 ? Number(limit) : BUILD_VOLUME_LIMIT_MM;
  return (
    Number(dimensions.x) > lim ||
    Number(dimensions.y) > lim ||
    Number(dimensions.z) > lim
  );
}

/**
 * Slicer-accurate support weight from per-triangle overhang data.
 * triangles: iterable of { areaMm2, normalY, centroidYMm }
 */
export function computeSupportWeight({
  triangles = null,
  overhangAreaMm2 = 0,
  avgOverhangHeightMm = null,
  totalAreaMm2 = 0,
  supportsEnabled = true,
  density = 1.24,
}) {
  let envelopeMm3 = 0;
  let measuredOverhangMm2 = 0;

  if (triangles && typeof triangles.length === 'number' && triangles.length > 0) {
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];
      const ny = t.normalY ?? t.ny ?? 0;
      const cy = t.centroidYMm ?? t.centroidY ?? t.h ?? 0;
      const area = t.areaMm2 ?? t.area ?? 0;
      if (ny < -OVERHANG_THRESHOLD_COS && cy > OVERHANG_MIN_HEIGHT_MM && area > 0) {
        const projected = area * Math.abs(ny);
        measuredOverhangMm2 += area;
        envelopeMm3 += projected * cy;
      }
    }
  } else if (overhangAreaMm2 > 0) {
    // Area fallback (backend path, no per-triangle heights): caller supplies
    // avgOverhangHeightMm; projected factor ~0.85 mean |ny| for steep faces.
    const h = avgOverhangHeightMm > 0 ? avgOverhangHeightMm : 10;
    measuredOverhangMm2 = overhangAreaMm2;
    envelopeMm3 = overhangAreaMm2 * 0.85 * h;
  }

  const overhangFraction = totalAreaMm2 > 0 ? measuredOverhangMm2 / totalAreaMm2 : 0;
  const supportVolumeCm3 = (envelopeMm3 / 1000) * SUPPORT_DENSITY_FACTOR;

  let supportWeightGrams = 0;
  let isPrintInPlace = true;
  if (supportsEnabled && supportVolumeCm3 > 0 && overhangFraction >= PRINT_IN_PLACE_FRACTION) {
    supportWeightGrams = Math.ceil(
      supportVolumeCm3 * density + SUPPORT_INTERFACE_ALLOWANCE_G
    );
    isPrintInPlace = false;
  } else if (supportVolumeCm3 <= 0 || overhangFraction < PRINT_IN_PLACE_FRACTION) {
    isPrintInPlace = true;
    supportWeightGrams = 0;
  } else {
    // supportsEnabled === false -> user opted out, still report potential
    isPrintInPlace = overhangFraction < PRINT_IN_PLACE_FRACTION;
    supportWeightGrams = 0;
  }

  return {
    overhangAreaMm2: measuredOverhangMm2,
    overhangFraction,
    supportVolumeCm3,
    supportWeightGrams,
    isPrintInPlace,
  };
}

/**
 * Zero-model quote: full result shape with every weight, cost, time and total
 * pinned to exactly 0. Returned when the 3D bed is empty (hasActiveModel false)
 * or the geometry is degenerate — the UI must never show a ghost price.
 */
export function zeroQuote(matConfig = MATERIALS.pla, profConfig = PRINT_PROFILES.standard, infillRatio = 0.2, layerHeight = 0.2) {
  const zeroVolumes = {
    totalMeshVolumeCm3: 0,
    shellVolumeCm3: 0,
    infillVolumeCm3: 0,
    supportVolumeCm3: 0,
    unitPlasticVolumeCm3: 0,
    unitPlasticVolumeMm3: 0,
    shellVolumeMm3: 0,
    infillVolumeMm3: 0,
    supportVolumeMm3: 0,
  };
  return {
    profile: { ...profConfig, layerHeightMm: layerHeight, infillPercentage: infillRatio, infillPercent: Math.round(infillRatio * 100) },
    infillPercent: Math.round(infillRatio * 100),
    infillRatio,
    layerHeightMm: layerHeight,
    material: matConfig,
    quantity: 1,
    supportsEnabled: true,
    hasActiveModel: false,
    emptyQuote: true,
    isThinWalled: false,
    autoBrim: false,
    brimWeightGrams: 0,
    brimWeightTotalGrams: 0,
    brimRatio: 0,
    layerSwap: false,
    volumes: zeroVolumes,
    partWeightGrams: 0,
    partWeightTotalGrams: 0,
    supportWeightGrams: 0,
    supportWeightTotalGrams: 0,
    supportOverhangAreaMm2: 0,
    supportOverhangFraction: 0,
    isPrintInPlace: true,
    supportTimeMins: 0,
    supportCostTotal: 0,
    partMaterialCost: 0,
    supportMaterialCost: 0,
    unitWeightGrams: 0,
    totalWeightGrams: 0,
    unitMachineHours: 0,
    totalMachineHours: 0,
    unitMaterialCost: 0,
    batchMaterialCost: 0,
    unitMachineCost: 0,
    batchMachineCost: 0,
    unitMakingCost: 0,
    batchMakingCost: 0,
    serviceFee: 0,
    handlingFee: 0,
    subtotalBeforeDiscount: 0,
    discountPercentage: 0,
    discountAmount: 0,
    subtotal: 0,
    totalPrice: 0,
    unitPrice: 0,
    minimumApplied: false,
    addOns: { total: 0, items: [], selected: {} },
    // Itemized INR identity lines (all zero on an empty bed)
    setupFeeINR: 0,
    modelMaterialCostINR: 0,
    supportMaterialCostINR: 0,
    machineTimeCostINR: 0,
    makingCostINR: 0,
    postProcessingAddonsINR: 0,
    printTimeMinutes: 0,
    totalPriceINR: 0,
  };
}

/**
 * Full quote with explicit Model vs Support split.
 * layerHeightMm: 0.08-0.28 override; thinner layers print slower.
 */
export function calculateQuote({
  volumeMm3,
  surfaceAreaMm2,
  dimensions = { x: 20, y: 20, z: 20 },
  profile = 'standard',
  layerHeightMm = null,
  infillPercent = null,
  infillPercentage = null,
  material = 'pla',
  overhangAreaMm2 = 0,
  avgOverhangHeightMm = null,
  supportTriangles = null,
  totalAreaMm2 = 0,
  supportsEnabled = true,
  quantity = 1,
  addOns = {},
  autoBrim = false,
  layerSwap = false,
  // Strict zero-model guardrail: false means the 3D bed is empty — the quote
  // MUST be exactly zero (never a base fee or the ₹149 minimum).
  hasActiveModel = true,
} = {}) {
  const matConfig = normalizeMaterial(material);
  const profConfig = normalizeProfile(profile);
  const rawInfill = infillPercent != null ? infillPercent : infillPercentage;
  const effectiveInfillRatio = normalizeInfillRatio(rawInfill, profConfig.infillPercentage);

  // TPU guardrail: clamp fine layers that jam flexible filament
  let requestedLayer = Number(layerHeightMm) > 0 ? Number(layerHeightMm) : profConfig.layerHeightMm;
  if (matConfig.id === 'tpu') requestedLayer = clampLayerHeightForMaterial(requestedLayer, 'tpu');
  const effLayerHeight = Math.min(0.28, Math.max(0.08, requestedLayer));

  const totalVolumeCm3 = (volumeMm3 || 0) / 1000;
  const surfaceAreaCm2 =
    surfaceAreaMm2 != null && surfaceAreaMm2 > 0
      ? surfaceAreaMm2 / 100
      : (6 * Math.cbrt(volumeMm3 || 1000) ** 2) / 100;

  const { shellVolumeCm3, infillVolumeCm3 } = computePartWeight({
    totalVolumeCm3,
    surfaceAreaCm2,
    wallThicknessCm: profConfig.wallThicknessCm,
    infillRatio: effectiveInfillRatio,
    density: matConfig.densityGPerCm3,
  });
  // Volume-conserved shell (0.92 cap) — no legacy 0.85 double-cap.
  const cappedShell = shellVolumeCm3;
  const cappedInfill = infillVolumeCm3;
  const isThinWalled = isThinWalledPart({ shellVolumeCm3: cappedShell, totalVolumeCm3 });
  const partWeightUnit = roundNum((cappedShell + cappedInfill) * matConfig.densityGPerCm3, 3);

  // Strict zero-model guardrail: empty bed (or degenerate geometry) prices to
  // exactly zero — no setup fee, no ₹149 minimum, no machine time.
  if (!hasActiveModel || !(totalVolumeCm3 > 0) || !(partWeightUnit > 0)) {
    return zeroQuote(matConfig, profConfig, effectiveInfillRatio, effLayerHeight);
  }

  const effOverhangH =
    avgOverhangHeightMm != null && avgOverhangHeightMm > 0
      ? avgOverhangHeightMm
      : dimensions.z
        ? dimensions.z * 0.5
        : 10;

  const support = computeSupportWeight({
    triangles: supportTriangles,
    overhangAreaMm2,
    avgOverhangHeightMm: effOverhangH,
    totalAreaMm2: totalAreaMm2 || surfaceAreaMm2 || 0,
    supportsEnabled,
    density: matConfig.densityGPerCm3,
  });

  const supportWeightUnit = supportsEnabled ? support.supportWeightGrams : 0;
  // A1 Mini bedslinger auto-brim (+1.5g) for tall/narrow parts
  const brimCheck = detectAutoBrim({ size: dimensions });
  const brimApplies = Boolean(autoBrim || brimCheck.needsBrim);
  const brimWeightUnit = brimApplies ? BRIM_WEIGHT_G : 0;
  const unitWeightGrams = roundNum(partWeightUnit + supportWeightUnit + brimWeightUnit, 3);

  // Time: thinner layers + denser supports take longer. Baseline throughput
  // scaled by profile speed, material speed, and layer-height ratio.
  const layerFactor = profConfig.layerHeightMm / effLayerHeight;
  const effectiveThroughput =
    matConfig.baseThroughputGPerHour * profConfig.speedFactor * matConfig.speedFactor;
  const partHours = partWeightUnit / effectiveThroughput;
  const supportHours = supportWeightUnit / Math.max(4, effectiveThroughput * 0.9);
  const unitMachineHours = roundNum((partHours + supportHours) * layerFactor, 2);

  const unitMaterialCost = roundNum(unitWeightGrams * matConfig.retailRatePerG, 2);
  const partMaterialCost = roundNum((partWeightUnit * matConfig.retailRatePerG), 2);
  const supportMaterialCost = roundNum(unitMaterialCost - partMaterialCost, 2);
  const unitMachineCost = roundNum(unitMachineHours * 25, 2);
  const unitMakingCost = roundNum(unitWeightGrams * 1.0, 2);

  const q = Math.max(1, parseInt(quantity, 10) || 1);
  const totalWeightGrams = roundNum(unitWeightGrams * q, 3);
  const partWeightGrams = roundNum(partWeightUnit * q, 3);
  const supportWeightGramsTotal = roundNum(supportWeightUnit * q, 3);
  const totalMachineHours = roundNum(unitMachineHours * q, 2);

  const batchMaterialCost = roundNum(unitMaterialCost * q, 2);
  const batchMachineCost = roundNum(unitMachineCost * q, 2);
  const batchMakingCost = roundNum(unitMakingCost * q, 2);
  const serviceFee = 49;
  const handlingFee = 0;

  const subtotalBeforeDiscount = roundNum(
    batchMaterialCost + batchMachineCost + batchMakingCost + serviceFee + handlingFee,
    2
  );

  let discountPercentage = 0;
  if (q >= 10) discountPercentage = 20;
  else if (q >= 5) discountPercentage = 10;
  const discountAmount = roundNum((subtotalBeforeDiscount * discountPercentage) / 100, 2);

  const selectedAddOns = addOns && typeof addOns === 'object' ? addOns : {};
  let addOnsTotal = 0;
  const itemizedAddOns = [];
  const texture = selectedAddOns.buildPlateTexture || selectedAddOns.texture;
  if (texture === 'carbon_fiber') {
    addOnsTotal += 49;
    itemizedAddOns.push({ id: 'carbon_fiber', name: 'Carbon Fiber Effect Texture', price: 49 });
  } else if (texture === 'smooth_pei') {
    addOnsTotal += 29;
    itemizedAddOns.push({ id: 'smooth_pei', name: 'Smooth PEI Mirror Finish', price: 29 });
  } else if (texture) {
    itemizedAddOns.push({ id: 'textured_pei', name: 'Textured PEI (Standard)', price: 0 });
  }
  const insertsCount = parseInt(selectedAddOns.heatSetInserts, 10) || 0;
  if (insertsCount > 0) {
    const c = insertsCount * 15;
    addOnsTotal += c;
    itemizedAddOns.push({ id: 'heat_set_brass_inserts', name: `Heat-Set Brass Inserts (${insertsCount}x)`, price: c, count: insertsCount });
  }
  if (selectedAddOns.supportSanding || selectedAddOns.sanding) {
    addOnsTotal += 49;
    itemizedAddOns.push({ id: 'support_sanding', name: 'Support Sanding & Pre-Assembly', price: 49 });
  }
  const layerSwapEnabled = Boolean(layerSwap || selectedAddOns.layerSwap || selectedAddOns.pauseAtHeight);
  if (layerSwapEnabled) {
    addOnsTotal += LAYER_SWAP_FEE_INR;
    itemizedAddOns.push({ id: 'layer_swap', name: 'Pause-at-Height Layer Color Swap', price: LAYER_SWAP_FEE_INR });
  }
  const brimWeightTotal = roundNum(brimWeightUnit * q, 3);

  const subtotal = roundNum(subtotalBeforeDiscount - discountAmount + addOnsTotal, 2);
  const rounded = Math.round(subtotal);
  const infillSurplus = Math.max(0, effectiveInfillRatio - 0.2);
  const effectiveMinFloor = Math.round(149 * (1 + infillSurplus * 0.6));
  const minimumApplied = rounded < effectiveMinFloor;
  const totalPrice = minimumApplied ? effectiveMinFloor : rounded;
  const unitPrice = roundNum(totalPrice / q, 2);

  // Support time/cost split for receipt UI
  const supportTimeMins = Math.round(supportHours * 60 * layerFactor * q);
  const supportCostTotal = roundNum(supportWeightGramsTotal * matConfig.retailRatePerG, 2);

  return {
    profile: { ...profConfig, layerHeightMm: effLayerHeight, infillPercentage: effectiveInfillRatio, infillPercent: Math.round(effectiveInfillRatio * 100) },
    infillPercent: Math.round(effectiveInfillRatio * 100),
    infillRatio: effectiveInfillRatio,
    layerHeightMm: effLayerHeight,
    material: matConfig,
    quantity: q,
    supportsEnabled,
    hasActiveModel: true,
    emptyQuote: false,
    isThinWalled,
    autoBrim: brimApplies,
    brimWeightGrams: brimWeightUnit,
    brimWeightTotalGrams: brimWeightTotal,
    brimRatio: brimCheck.ratio || 0,
    layerSwap: layerSwapEnabled,
    volumes: {
      totalMeshVolumeCm3: roundNum(totalVolumeCm3, 3),
      shellVolumeCm3: roundNum(cappedShell, 3),
      infillVolumeCm3: roundNum(cappedInfill, 3),
      supportVolumeCm3: roundNum(support.supportVolumeCm3, 3),
      unitPlasticVolumeCm3: roundNum(cappedShell + cappedInfill + support.supportVolumeCm3, 3),
      unitPlasticVolumeMm3: roundNum((cappedShell + cappedInfill + support.supportVolumeCm3) * 1000, 3),
      shellVolumeMm3: roundNum(cappedShell * 1000, 3),
      infillVolumeMm3: roundNum(cappedInfill * 1000, 3),
      supportVolumeMm3: roundNum(support.supportVolumeCm3 * 1000, 3),
    },
    partWeightGrams: partWeightUnit,
    partWeightTotalGrams: partWeightGrams,
    supportWeightGrams: supportWeightUnit,
    supportWeightTotalGrams: supportWeightGramsTotal,
    supportOverhangAreaMm2: roundNum(support.overhangAreaMm2, 1),
    supportOverhangFraction: support.overhangFraction,
    isPrintInPlace: support.isPrintInPlace,
    supportTimeMins,
    supportCostTotal,
    partMaterialCost,
    supportMaterialCost,
    unitWeightGrams,
    totalWeightGrams,
    unitMachineHours,
    totalMachineHours,
    unitMaterialCost,
    batchMaterialCost,
    unitMachineCost,
    batchMachineCost,
    unitMakingCost,
    batchMakingCost,
    serviceFee,
    handlingFee,
    subtotalBeforeDiscount,
    discountPercentage,
    discountAmount,
    subtotal,
    totalPrice,
    unitPrice,
    minimumApplied,
    addOns: { total: addOnsTotal, items: itemizedAddOns, selected: selectedAddOns },
    // Itemized INR identity: totalPriceINR is exactly totalPrice, decomposed as
    //   round((model + support + machine + making) * q + setup - discount + addOns)
    // floored at the minimum. Receipt Total, UPI QR am= and Scan badge all read
    // totalPriceINR so the three can never desynchronize.
    setupFeeINR: roundNum(serviceFee + handlingFee, 2),
    modelMaterialCostINR: partMaterialCost,
    supportMaterialCostINR: supportMaterialCost,
    machineTimeCostINR: unitMachineCost,
    makingCostINR: unitMakingCost,
    postProcessingAddonsINR: addOnsTotal,
    printTimeMinutes: Math.round(unitMachineHours * 60),
    totalPriceINR: totalPrice,
  };
}

/** Legacy alias kept for existing callers/tests. */
export function calculateSlicerMetrics(opts = {}) {
  const q = calculateQuote(opts);
  return {
    ...q,
    partMaterialCost: q.partMaterialCost,
    supportMaterialCost: q.supportMaterialCost,
    ratePerGram: q.material.retailRatePerG,
    supportCostTotal: q.supportCostTotal,
  };
}

export default {
  MATERIALS,
  PRINT_PROFILES,
  OVERHANG_THRESHOLD_COS,
  SUPPORT_DENSITY_FACTOR,
  SHELL_VOLUME_CAP_FRACTION,
  THIN_WALL_SOLID_FRACTION,
  BRIM_WEIGHT_G,
  LAYER_SWAP_FEE_INR,
  BUILD_VOLUME_LIMIT_MM,
  normalizeMaterial,
  normalizeProfile,
  computePartWeight,
  computeSupportWeight,
  isThinWalledPart,
  detectAutoBrim,
  clampLayerHeightForMaterial,
  exceedsBuildVolume,
  zeroQuote,
  calculateQuote,
  calculateSlicerMetrics,
};
