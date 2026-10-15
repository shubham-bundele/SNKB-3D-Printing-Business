'use strict';

/**
 * INR pricing engine for the SNKB 3D Studio storefront.
 *
 * Customer-facing quotes are itemized like Indian 3D-printing services
 * (material + machine time + fixed service charge, with a small-print minimum):
 *
 *   materialCost = weight(g) x MATERIAL_RATE_PER_G        (retail PLA+ rate)
 *   machineHours = weight(g) / PRINT_GRAMS_PER_HOUR       (throughput estimate)
 *   machineCost  = machineHours x MACHINE_RATE_PER_HOUR
 *   makingCost   = weight(g) x MAKING_RATE_PER_G          (print labor)
 *   serviceFee   = SERVICE_FEE_FLAT                       (handling, slicing, QA)
 *   handlingFee  = HANDLING_FEE_FLAT                      (box, cushioning, labels)
 *   totalPrice   = max(MIN_ORDER_VALUE, round(subtotal))  (whole rupees)
 *
 * Market basis (Pan-India FDM services): retail PLA+ ≈ ₹2.00/g against
 * ₹1,800/kg raw filament; machine time ≈ ₹25/print-hour; print labor
 * (monitoring, support removal, finishing) ≈ ₹1.00/g; order handling,
 * slicing and QA ≈ ₹39 fixed; packaging & dispatch
 * handling ≈ ₹25 fixed; order minima ₹149+ (parcel shipping alone runs
 * ₹80–150). Listed prices are GST-inclusive. All knobs are env-overridable.
 */

/** Standard production build volume limit is 180 x 180 x 180 mm per part (multi-part assemblies routed to farm queue). */
const BUILD_VOLUME_LIMIT_MM = 180;

/** Quoted currency. */
const CURRENCY = 'INR';

/** Material properties and profiles (canonical values mirror src/utils/pricingEngine.js). */
const PLA_DENSITY_G_PER_CM3 = 1.24;
const PLA_DENSITY_G_PER_MM3 = PLA_DENSITY_G_PER_CM3 / 1000; // 0.00124 g/mm^3
const PETG_DENSITY_G_PER_CM3 = 1.27;
const PETG_DENSITY_G_PER_MM3 = PETG_DENSITY_G_PER_CM3 / 1000;
const TPU_DENSITY_G_PER_CM3 = 1.21;
const TPU_DENSITY_G_PER_MM3 = TPU_DENSITY_G_PER_CM3 / 1000; // 0.00121 g/mm^3

/** Raw filament cost basis (matches the admin dashboard's ₹1,800/kg PLA+). */
const RAW_FILAMENT_PRICE_PER_KG = 1800;

const numEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Retail material rates (spec: PLA+ Rs 2.00/g, PETG Rs 2.50/g, TPU Rs 3.50/g). */
const MATERIAL_RATE_PER_G = numEnv('SNKB_MATERIAL_RATE_PER_G', 2.0);
const PLA_RATE_PER_G = numEnv('SNKB_PLA_RATE_PER_G', 2.0);
const PETG_RATE_PER_G = numEnv('SNKB_PETG_RATE_PER_G', 2.5);
const TPU_RATE_PER_G = numEnv('SNKB_TPU_RATE_PER_G', 3.5);

/** Machine-time rate per print hour (matches admin "~₹25 / print hr"). */
const MACHINE_RATE_PER_HOUR = numEnv('SNKB_MACHINE_RATE_PER_HOUR', 25);
/**
 * Sustained throughput assumption for time estimates: 0.4 mm nozzle,
 * 0.2 mm layers, ~20% infill → roughly 12 g of extruded PLA+ per hour.
 */
const PRINT_GRAMS_PER_HOUR = numEnv('SNKB_PRINT_GRAMS_PER_HOUR', 12);
/** Fixed service charge: order handling, slicing setup, QA, customer support. */
const SERVICE_FEE_FLAT = numEnv('SNKB_SERVICE_FEE', 39);
/**
 * Print-labor rate (₹/g): machine monitoring, support removal, surface
 * finishing. Scales with part size like material does.
 */
const MAKING_RATE_PER_G = numEnv('SNKB_MAKING_RATE_PER_G', 1.0);
/**
 * Fixed handling charge: shipping box, cushioning, labels.
 * Courier freight itself is quoted separately at checkout by PIN.
 */
const HANDLING_FEE_FLAT = numEnv('SNKB_HANDLING_FEE', 25);
/** Small-print minimum order value (covers handling economics). */
const MIN_ORDER_VALUE = numEnv('SNKB_MIN_ORDER_VALUE', 149);

/** Material catalog for FDM engineering (mirrors pricingEngine.MATERIALS). */
const MATERIALS = {
  pla: {
    id: 'pla',
    name: 'Tough PLA+',
    densityGPerCm3: PLA_DENSITY_G_PER_CM3,
    densityGPerMm3: PLA_DENSITY_G_PER_MM3,
    retailRatePerG: PLA_RATE_PER_G,
    speedFactor: 1.0,
    baseThroughputGPerHour: 12,
  },
  petg: {
    id: 'petg',
    name: 'PETG / Industrial',
    densityGPerCm3: PETG_DENSITY_G_PER_CM3,
    densityGPerMm3: PETG_DENSITY_G_PER_MM3,
    retailRatePerG: PETG_RATE_PER_G,
    speedFactor: 0.85,
    baseThroughputGPerHour: 12,
  },
  tpu: {
    id: 'tpu',
    name: 'Flexible TPU 95A',
    densityGPerCm3: TPU_DENSITY_G_PER_CM3,
    densityGPerMm3: TPU_DENSITY_G_PER_MM3,
    retailRatePerG: TPU_RATE_PER_G,
    speedFactor: 0.55,
    baseThroughputGPerHour: 12,
  },
};

/**
 * Print Profiles:
 *  - Draft: 0.24mm layers, 10% infill, 2 walls (0.8mm)
 *  - Standard: 0.20mm layers, 20% infill, 3 walls (1.2mm)
 *  - Heavy-Duty Structural: 0.16mm layers, 45% infill, 4 walls (1.6mm)
 */
const PRINT_PROFILES = {
  draft: {
    id: 'draft',
    name: 'Draft (0.24mm / 10% Infill)',
    layerHeightMm: 0.24,
    infillPercentage: 0.10,
    wallCount: 2,
    wallThicknessCm: 0.08,
    speedFactor: 1.30,
  },
  standard: {
    id: 'standard',
    name: 'Standard (0.20mm / 20% Infill)',
    layerHeightMm: 0.20,
    infillPercentage: 0.20,
    wallCount: 3,
    wallThicknessCm: 0.12,
    speedFactor: 1.00,
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

const AXES = ['x', 'y', 'z'];

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Reject any model whose bounding box exceeds the printer's build volume.
 *
 * @param {{ x: number, y: number, z: number }} dimensions
 * @returns {{ valid: boolean, exceededAxes: Array<{axis: string, dimension: number, limit: number, excess: number}> }}
 */
function validateBuildVolume(dimensions) {
  const exceededAxes = [];

  for (const axis of AXES) {
    const dimension = dimensions[axis];

    if (dimension > BUILD_VOLUME_LIMIT_MM) {
      exceededAxes.push({
        axis,
        dimension: round(dimension, 3),
        limit: BUILD_VOLUME_LIMIT_MM,
        excess: round(dimension - BUILD_VOLUME_LIMIT_MM, 3),
      });
    }
  }

  return { valid: exceededAxes.length === 0, exceededAxes };
}

/** Weight (g) = Volume (mm^3) x PLA+ density (g/mm^3). */
function calculateWeightGrams(volumeMm3) {
  return volumeMm3 * PLA_DENSITY_G_PER_MM3;
}

/** Retail material charge (₹) = Weight (g) x material rate (₹/g). */
function calculateMaterialCost(weightGrams) {
  return weightGrams * MATERIAL_RATE_PER_G;
}

/** Estimated print time (h) from the sustained-throughput assumption. */
function calculateMachineHours(weightGrams) {
  if (!(PRINT_GRAMS_PER_HOUR > 0)) return 0;
  return weightGrams / PRINT_GRAMS_PER_HOUR;
}

/** Machine-time charge (₹) = hours x machine rate (₹/h). */
function calculateMachineCost(machineHours) {
  return machineHours * MACHINE_RATE_PER_HOUR;
}

/** Fixed service charge (₹): order handling, slicing setup, QA, support. */
function calculateServiceFee() {
  return SERVICE_FEE_FLAT;
}

/** Print-labor charge (₹) = Weight (g) x making rate (₹/g). */
function calculateMakingCost(weightGrams) {
  return weightGrams * MAKING_RATE_PER_G;
}

/** Fixed handling charge (₹): box, cushioning, labels, dispatch. */
function calculateHandlingFee() {
  return HANDLING_FEE_FLAT;
}

/**
 * Customer total (whole rupees): material + machine + making + service +
 * handling, floored at the minimum order value so tiny prints still cover
 * handling and dispatch.
 *
 * @returns {{ subtotal:number, totalPrice:number, minimumApplied:boolean }}
 */
function calculateTotalPrice({ materialCost, machineCost, makingCost, serviceFee, handlingFee }) {
  const subtotal = round(
    materialCost + machineCost + makingCost + serviceFee + handlingFee,
    2
  );
  const rounded = Math.round(subtotal);
  const minimumApplied = rounded < MIN_ORDER_VALUE;
  return {
    subtotal,
    totalPrice: minimumApplied ? MIN_ORDER_VALUE : rounded,
    minimumApplied,
  };
}

/**
 * Realistic FDM shell + infill + support math (canonical: src/utils/pricingEngine.js):
 *   shellVolume = min(totalVolume, surfaceArea * wallThicknessCm)
 *   infillVolume = max(0, totalVolume - shellVolume) * infillPercentage
 *   supportVolume = overhangArea * avgOverhangHeightCm * 0.18 (density) + 1.5g allowance
 */
function calculateSlicerMetrics({
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
  // Strict zero-model guardrail: false means the 3D bed is empty — quote is exactly zero.
  hasActiveModel = true,
} = {}) {
  const normMatKey = (typeof material === 'string' ? material.toLowerCase() : 'pla');
  const matConfig = normMatKey.includes('tpu')
    ? MATERIALS.tpu
    : normMatKey.includes('petg')
      ? MATERIALS.petg
      : MATERIALS.pla;

  const normProfKey = (typeof profile === 'string' ? profile.toLowerCase().replace(/_/g, '-') : 'standard');
  const profConfig = PRINT_PROFILES[normProfKey] || PRINT_PROFILES.standard;
  const effLayerHeight = Math.min(0.28, Math.max(0.08, Number(layerHeightMm) > 0 ? Number(layerHeightMm) : profConfig.layerHeightMm));

  // Custom or profile-derived infill ratio (10% -> 0.10, 20% -> 0.20, 45% -> 0.45, 100% -> 1.00)
  const rawInfill = infillPercent != null ? infillPercent : infillPercentage;
  const effectiveInfillRatio = (typeof rawInfill === 'number' && rawInfill > 0)
    ? Math.min(1.0, Math.max(0.05, rawInfill > 1 ? rawInfill / 100 : rawInfill))
    : profConfig.infillPercentage;

  const totalVolumeCm3 = (volumeMm3 || 0) / 1000;
  const surfaceAreaCm2 = (surfaceAreaMm2 != null && surfaceAreaMm2 > 0)
    ? surfaceAreaMm2 / 100
    : (6 * Math.cbrt(volumeMm3 || 1000) ** 2) / 100;

  // 1. Shell volume: perimeters and top/bottom solid layers
  // Avoid shell consuming 100% of volume on small/thin parts so an infillable core is always available
  const rawShellCm3 = surfaceAreaCm2 * profConfig.wallThicknessCm;
  const shellVolumeCm3 = Math.min(totalVolumeCm3 * 0.85, rawShellCm3);

  // 2. Infill volume: internal infill grid scaled directly with effectiveInfillRatio
  const infillCoreCm3 = Math.max(0, totalVolumeCm3 - shellVolumeCm3);
  const infillVolumeCm3 = infillCoreCm3 * effectiveInfillRatio;
  const partWeightUnit = round((shellVolumeCm3 + infillVolumeCm3) * matConfig.densityGPerCm3, 3);

  // Strict zero-model guardrail: empty bed (or degenerate geometry) prices to
  // exactly zero — no setup fee, no ₹149 minimum, no machine time.
  if (!hasActiveModel || !(totalVolumeCm3 > 0) || !(partWeightUnit > 0)) {
    return zeroSlicerQuote(matConfig, profConfig, effectiveInfillRatio, effLayerHeight);
  }

  // 3. Support volume: slicer-accurate 18% density + 1.5g interface/brim allowance.
  // Per-triangle path when the viewer supplies supportTriangles, else area fallback.
  let supportVolumeCm3 = 0;
  let measuredOverhangMm2 = Number(overhangAreaMm2) || 0;
  let overhangFraction = 0;
  if (Array.isArray(supportTriangles) && supportTriangles.length > 0) {
    let envelope = 0;
    let totalA = totalAreaMm2 || surfaceAreaMm2 || 0;
    for (const t of supportTriangles) {
      const ny = t.normalY ?? t.ny ?? 0;
      const cy = t.centroidYMm ?? t.centroidY ?? 0;
      const area = t.areaMm2 ?? t.area ?? 0;
      if (ny < -Math.SQRT1_2 && cy > 0.8 && area > 0) {
        envelope += area * Math.abs(ny) * cy;
      }
    }
    measuredOverhangMm2 = supportTriangles
      .filter((t) => (t.normalY ?? 0) < -Math.SQRT1_2 && (t.centroidYMm ?? 0) > 0.8)
      .reduce((s, t) => s + (t.areaMm2 ?? 0), 0);
    const totalForFrac = totalA > 0 ? totalA : surfaceAreaMm2 || 0;
    overhangFraction = totalForFrac > 0 ? measuredOverhangMm2 / totalForFrac : 0;
    supportVolumeCm3 = (envelope / 1000) * 0.18;
  } else {
    const overhangAreaCm2 = (overhangAreaMm2 || 0) / 100;
    const effectiveOverhangHeightMm = avgOverhangHeightMm != null && avgOverhangHeightMm > 0
      ? avgOverhangHeightMm
      : (dimensions.z ? dimensions.z * 0.5 : 10);
    const avgOverhangHeightCm = effectiveOverhangHeightMm / 10;
    supportVolumeCm3 = overhangAreaCm2 * avgOverhangHeightCm * 0.18;
    const totalForFrac = (totalAreaMm2 || surfaceAreaMm2 || 0);
    overhangFraction = totalForFrac > 0 ? measuredOverhangMm2 / totalForFrac : 0;
  }
  // Print-in-place: overhangs < 5% need no supports
  let supportWeightUnit = 0;
  let isPrintInPlace = true;
  if (supportsEnabled && supportVolumeCm3 > 0 && overhangFraction >= 0.05) {
    supportWeightUnit = Math.ceil(supportVolumeCm3 * matConfig.densityGPerCm3 + 1.5);
    isPrintInPlace = false;
  }

  const unitWeightGrams = round(partWeightUnit + supportWeightUnit, 3);

  const matSpeed = matConfig.speedFactor || 1.0;
  const layerFactor = profConfig.layerHeightMm / effLayerHeight;
  const effectiveThroughput = matConfig.baseThroughputGPerHour * profConfig.speedFactor * matSpeed;
  const partHours = partWeightUnit / effectiveThroughput;
  const supportHours = supportWeightUnit / Math.max(4, effectiveThroughput * 0.9);
  const unitMachineHours = round((partHours + supportHours) * layerFactor, 2);

  const unitMaterialCost = round(unitWeightGrams * matConfig.retailRatePerG, 2);
  const partMaterialCost = round(partWeightUnit * matConfig.retailRatePerG, 2);
  const supportMaterialCost = round(unitMaterialCost - partMaterialCost, 2);
  const unitMachineCost = round(unitMachineHours * MACHINE_RATE_PER_HOUR, 2);
  const unitMakingCost = round(unitWeightGrams * MAKING_RATE_PER_G, 2);

  const q = Math.max(1, parseInt(quantity, 10) || 1);
  const totalWeightGrams = round(unitWeightGrams * q, 3);
  const totalMachineHours = round(unitMachineHours * q, 2);

  const batchMaterialCost = round(unitMaterialCost * q, 2);
  const batchMachineCost = round(unitMachineCost * q, 2);
  const batchMakingCost = round(unitMakingCost * q, 2);
  const serviceFee = calculateServiceFee();
  const handlingFee = calculateHandlingFee() + Math.max(0, q - 1) * 5;

  const subtotalBeforeDiscount = round(
    batchMaterialCost + batchMachineCost + batchMakingCost + serviceFee + handlingFee,
    2
  );

  // Automatic bulk discount at 5+ units (10%) and 10+ units (20%)
  let discountPercentage = 0;
  if (q >= 10) {
    discountPercentage = 20;
  } else if (q >= 5) {
    discountPercentage = 10;
  }

  const discountAmount = round((subtotalBeforeDiscount * discountPercentage) / 100, 2);

  // Post-processing and value-added options
  const selectedAddOns = (addOns && typeof addOns === 'object') ? addOns : {};
  let addOnsTotal = 0;
  const itemizedAddOns = [];

  const texture = selectedAddOns.buildPlateTexture || selectedAddOns.texture;
  if (texture === 'carbon_fiber') {
    addOnsTotal += 49;
    itemizedAddOns.push({ id: 'carbon_fiber', name: 'Carbon Fiber Effect Texture', price: 49 });
  } else if (texture === 'smooth_pei') {
    itemizedAddOns.push({ id: 'smooth_pei', name: 'Smooth PEI Mirror Finish', price: 0 });
  } else if (texture) {
    itemizedAddOns.push({ id: 'textured_pei', name: 'Textured PEI (Standard)', price: 0 });
  }

  const insertsCount = parseInt(selectedAddOns.heatSetInserts, 10) || 0;
  if (insertsCount > 0) {
    const cost = insertsCount * 15;
    addOnsTotal += cost;
    itemizedAddOns.push({ id: 'heat_set_brass_inserts', name: `Heat-Set Brass Inserts (${insertsCount}×)`, price: cost, count: insertsCount });
  }

  if (selectedAddOns.supportSanding || selectedAddOns.sanding) {
    addOnsTotal += 49;
    itemizedAddOns.push({ id: 'support_sanding', name: 'Support Sanding & Pre-Assembly', price: 49 });
  }

  const subtotal = round(subtotalBeforeDiscount - discountAmount + addOnsTotal, 2);
  const rounded = Math.round(subtotal);

  // Infill Monotonicity Engine:
  // Base floor covers up to standard 20% infill. Above 20% infill, higher density
  // consumes significantly more material & extruder work; scale the minimum order floor
  // so the cost strictly rises as infill increases, even on sub-minimum prints.
  const infillSurplus = Math.max(0, effectiveInfillRatio - 0.20);
  const effectiveMinFloor = Math.round(MIN_ORDER_VALUE * (1 + infillSurplus * 0.6));
  const minimumApplied = rounded < effectiveMinFloor;
  const totalPrice = minimumApplied ? effectiveMinFloor : rounded;
  const unitPrice = round(totalPrice / q, 2);

  return {
    profile: {
      ...profConfig,
      layerHeightMm: effLayerHeight,
      infillPercentage: effectiveInfillRatio,
      infillPercent: Math.round(effectiveInfillRatio * 100),
    },
    infillPercent: Math.round(effectiveInfillRatio * 100),
    infillRatio: effectiveInfillRatio,
    layerHeightMm: effLayerHeight,
    material: matConfig,
    quantity: q,
    supportsEnabled,
    hasActiveModel: true,
    emptyQuote: false,
    partWeightGrams: partWeightUnit,
    supportWeightGrams: supportWeightUnit,
    supportOverhangAreaMm2: round(measuredOverhangMm2, 1),
    supportOverhangFraction: overhangFraction,
    isPrintInPlace,
    partMaterialCost,
    supportMaterialCost,
    volumes: {
      totalMeshVolumeCm3: round(totalVolumeCm3, 3),
      shellVolumeCm3: round(shellVolumeCm3, 3),
      infillVolumeCm3: round(infillVolumeCm3, 3),
      supportVolumeCm3: round(supportVolumeCm3, 3),
      unitPlasticVolumeCm3: round(shellVolumeCm3 + infillVolumeCm3 + supportVolumeCm3, 3),
      unitPlasticVolumeMm3: round((shellVolumeCm3 + infillVolumeCm3 + supportVolumeCm3) * 1000, 3),
      shellVolumeMm3: round(shellVolumeCm3 * 1000, 3),
      infillVolumeMm3: round(infillVolumeCm3 * 1000, 3),
      supportVolumeMm3: round(supportVolumeCm3 * 1000, 3),
    },
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
    addOns: {
      total: addOnsTotal,
      items: itemizedAddOns,
      selected: selectedAddOns,
    },
    // Itemized INR identity: totalPriceINR is exactly totalPrice. Receipt Total,
    // UPI QR am= and Scan badge all read totalPriceINR so they stay in sync.
    setupFeeINR: round(serviceFee + handlingFee, 2),
    modelMaterialCostINR: partMaterialCost,
    supportMaterialCostINR: supportMaterialCost,
    machineTimeCostINR: unitMachineCost,
    makingCostINR: unitMakingCost,
    postProcessingAddonsINR: addOnsTotal,
    printTimeMinutes: Math.round(unitMachineHours * 60),
    totalPriceINR: totalPrice,
  };
}

/**
 * Zero-model quote: full slicer result shape with every weight, cost, time
 * and total pinned to exactly 0. Returned when the 3D bed is empty.
 */
function zeroSlicerQuote(matConfig, profConfig, effectiveInfillRatio, effLayerHeight) {
  const ratio = effectiveInfillRatio || 0.2;
  const layer = effLayerHeight || 0.2;
  return {
    profile: {
      ...profConfig,
      layerHeightMm: layer,
      infillPercentage: ratio,
      infillPercent: Math.round(ratio * 100),
    },
    infillPercent: Math.round(ratio * 100),
    infillRatio: ratio,
    layerHeightMm: layer,
    material: matConfig,
    quantity: 1,
    supportsEnabled: true,
    hasActiveModel: false,
    emptyQuote: true,
    partWeightGrams: 0,
    supportWeightGrams: 0,
    supportOverhangAreaMm2: 0,
    supportOverhangFraction: 0,
    isPrintInPlace: true,
    partMaterialCost: 0,
    supportMaterialCost: 0,
    volumes: {
      totalMeshVolumeCm3: 0,
      shellVolumeCm3: 0,
      infillVolumeCm3: 0,
      supportVolumeCm3: 0,
      unitPlasticVolumeCm3: 0,
      unitPlasticVolumeMm3: 0,
      shellVolumeMm3: 0,
      infillVolumeMm3: 0,
      supportVolumeMm3: 0,
    },
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
    addOns: {
      total: 0,
      items: [],
      selected: {},
    },
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
 * Assemble the structured quote payload returned by `POST /api/quote`.
 *
 * @param {object} geometry result of `parseStl`
 * @param {object} [file] multer file object
 * @param {object} [options] print profile, material, quantity
 */
function buildQuote(geometry, file, options = {}) {
  const dimensions = {
    x: round(geometry.dimensions.x, 3),
    y: round(geometry.dimensions.y, 3),
    z: round(geometry.dimensions.z, 3),
  };
  const volumeMm3 = round(geometry.volumeMm3, 3);
  const surfaceAreaMm2 = geometry.surfaceAreaMm2 != null ? round(geometry.surfaceAreaMm2, 3) : null;

  const requestedProfile = options.profile || options.printProfile;
  const requestedMaterial = options.material;
  const requestedQuantity = options.quantity;

  const isSlicerMode = Boolean(requestedProfile || options.useSlicer);

  if (isSlicerMode) {
    const slicer = calculateSlicerMetrics({
      volumeMm3,
      surfaceAreaMm2,
      dimensions,
      profile: requestedProfile || 'standard',
      layerHeightMm: options.layerHeightMm || options.layer_height || options.layerHeight || null,
      infillPercent: options.infillPercent != null ? options.infillPercent : (options.infill != null ? options.infill : options.infillPercentage),
      material: requestedMaterial || 'pla',
      overhangAreaMm2: options.overhangAreaMm2 || options.overhangArea,
      avgOverhangHeightMm: options.avgOverhangHeightMm || options.avgOverhangHeight,
      supportTriangles: options.supportTriangles || null,
      totalAreaMm2: options.totalAreaMm2 || surfaceAreaMm2 || 0,
      supportsEnabled: options.supportsEnabled ?? options.supports_enabled ?? true,
      quantity: requestedQuantity || 1,
      addOns: options.addOns || {},
      hasActiveModel: options.hasActiveModel ?? true,
    });

    return {
      file: {
        name: file ? file.originalname : null,
        sizeBytes: file ? file.size : null,
        format: geometry.format,
        triangleCount: geometry.triangleCount,
      },
      dimensions,
      boundingBox: geometry.boundingBox,
      volumeMm3,
      surfaceAreaMm2,
      weightGrams: slicer.totalWeightGrams,
      unitWeightGrams: slicer.unitWeightGrams,
      partWeightGrams: slicer.partWeightGrams,
      supportWeightGrams: slicer.supportWeightGrams,
      supportsEnabled: slicer.supportsEnabled,
      supportOverhangAreaMm2: slicer.supportOverhangAreaMm2,
      isPrintInPlace: slicer.isPrintInPlace,
      partMaterialCost: slicer.partMaterialCost,
      supportMaterialCost: slicer.supportMaterialCost,
      layerHeightMm: slicer.layerHeightMm,
      materialCost: slicer.batchMaterialCost,
      unitMaterialCost: slicer.unitMaterialCost,
      machineHours: slicer.totalMachineHours,
      unitMachineHours: slicer.unitMachineHours,
      machineCost: slicer.batchMachineCost,
      makingCost: slicer.batchMakingCost,
      serviceFee: slicer.serviceFee,
      handlingFee: slicer.handlingFee,
      subtotalBeforeDiscount: slicer.subtotalBeforeDiscount,
      discountPercentage: slicer.discountPercentage,
      discountAmount: slicer.discountAmount,
      subtotal: slicer.subtotal,
      totalPrice: slicer.totalPrice,
      unitPrice: slicer.unitPrice,
      quantity: slicer.quantity,
      minimumApplied: slicer.minimumApplied,
      hasActiveModel: slicer.hasActiveModel,
      emptyQuote: slicer.emptyQuote,
      setupFeeINR: slicer.setupFeeINR,
      modelMaterialCostINR: slicer.modelMaterialCostINR,
      supportMaterialCostINR: slicer.supportMaterialCostINR,
      machineTimeCostINR: slicer.machineTimeCostINR,
      makingCostINR: slicer.makingCostINR,
      postProcessingAddonsINR: slicer.postProcessingAddonsINR,
      printTimeMinutes: Math.round(slicer.totalMachineHours * 60),
      totalPriceINR: slicer.totalPriceINR,
      addOns: slicer.addOns,
      currency: CURRENCY,
      material: {
        id: slicer.material.id,
        name: slicer.material.name,
        densityGPerCm3: slicer.material.densityGPerCm3,
        retailRatePerG: slicer.material.retailRatePerG,
      },
      profile: {
        id: slicer.profile.id,
        name: slicer.profile.name,
        layerHeightMm: slicer.profile.layerHeightMm,
        infillPercentage: slicer.profile.infillPercentage,
        infillPercent: slicer.infillPercent,
        wallCount: slicer.profile.wallCount,
        wallThicknessCm: slicer.profile.wallThicknessCm,
      },
      infillPercent: slicer.infillPercent,
      infillRatio: slicer.infillRatio,
      volumes: slicer.volumes,
      pricing: {
        machineRatePerHour: MACHINE_RATE_PER_HOUR,
        serviceFee: SERVICE_FEE_FLAT,
        makingRatePerG: MAKING_RATE_PER_G,
        handlingFee: HANDLING_FEE_FLAT,
        minOrderValue: MIN_ORDER_VALUE,
      },
      buildVolume: {
        x: BUILD_VOLUME_LIMIT_MM,
        y: BUILD_VOLUME_LIMIT_MM,
        z: BUILD_VOLUME_LIMIT_MM,
      },
      withinBuildVolume: true,
    };
  }

  // Fallback naive 100%-solid pricing (preserves backwards-compatibility with tests)
  const weightGrams = round(calculateWeightGrams(volumeMm3), 3);
  const materialCost = round(calculateMaterialCost(weightGrams), 2);
  const machineHours = round(calculateMachineHours(weightGrams), 2);
  const machineCost = round(calculateMachineCost(machineHours), 2);
  const makingCost = round(calculateMakingCost(weightGrams), 2);
  const serviceFee = round(calculateServiceFee(), 2);
  const handlingFee = round(calculateHandlingFee(), 2);
  const { subtotal, totalPrice, minimumApplied } = calculateTotalPrice({
    materialCost,
    machineCost,
    makingCost,
    serviceFee,
    handlingFee,
  });

  return {
    file: {
      name: file ? file.originalname : null,
      sizeBytes: file ? file.size : null,
      format: geometry.format,
      triangleCount: geometry.triangleCount,
    },
    dimensions,
    boundingBox: geometry.boundingBox,
    volumeMm3,
    surfaceAreaMm2,
    weightGrams,
    materialCost,
    machineHours,
    machineCost,
    makingCost,
    serviceFee,
    handlingFee,
    subtotal,
    totalPrice,
    minimumApplied,
    currency: CURRENCY,
    material: {
      name: 'PLA+',
      densityGPerCm3: PLA_DENSITY_G_PER_CM3,
      pricePerKg: RAW_FILAMENT_PRICE_PER_KG,
      retailRatePerG: MATERIAL_RATE_PER_G,
    },
    pricing: {
      machineRatePerHour: MACHINE_RATE_PER_HOUR,
      gramsPerHour: PRINT_GRAMS_PER_HOUR,
      serviceFee: SERVICE_FEE_FLAT,
      makingRatePerG: MAKING_RATE_PER_G,
      handlingFee: HANDLING_FEE_FLAT,
      minOrderValue: MIN_ORDER_VALUE,
    },
    buildVolume: {
      x: BUILD_VOLUME_LIMIT_MM,
      y: BUILD_VOLUME_LIMIT_MM,
      z: BUILD_VOLUME_LIMIT_MM,
    },
    withinBuildVolume: true,
  };
}

module.exports = {
  BUILD_VOLUME_LIMIT_MM,
  CURRENCY,
  PLA_DENSITY_G_PER_CM3,
  PLA_DENSITY_G_PER_MM3,
  PETG_DENSITY_G_PER_CM3,
  PETG_DENSITY_G_PER_MM3,
  TPU_DENSITY_G_PER_CM3,
  TPU_DENSITY_G_PER_MM3,
  RAW_FILAMENT_PRICE_PER_KG,
  MATERIAL_RATE_PER_G,
  PLA_RATE_PER_G,
  PETG_RATE_PER_G,
  TPU_RATE_PER_G,
  MACHINE_RATE_PER_HOUR,
  PRINT_GRAMS_PER_HOUR,
  SERVICE_FEE_FLAT,
  MAKING_RATE_PER_G,
  HANDLING_FEE_FLAT,
  MIN_ORDER_VALUE,
  MATERIALS,
  PRINT_PROFILES,
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
  zeroSlicerQuote,
  buildQuote,
  round,
};
