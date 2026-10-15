'use strict';

/**
 * Pan-India delivery charge calculator for SNKB 3D Studio parcels.
 *
 * Modelled on Indian courier economics (Delhivery / XpressBees / Ecom Express
 * style surface rates): a base slab covers the first 500 g, every additional
 * 500 g slab adds a fixed extra, and metro hubs ship cheaper than the rest of
 * India. Chargeable weight is the greater of actual parcel weight (print +
 * box/packaging buffer) and volumetric weight (L×W×H / 5000, the standard
 * Indian courier divisor). Orders at or above the free-shipping threshold
 * ship free.
 *
 * All knobs are env-overridable; the module is pure (no I/O) so the same code
 * runs in unit tests and inside the Express checkout flow.
 */

const numEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Indian PIN code: 6 digits, first digit 1-9 (no PIN starts with 0). */
const PINCODE_RE = /^[1-9][0-9]{5}$/;

/**
 * Two-digit PIN prefixes served as metro hubs (cheaper base slab).
 * Delhi NCR, Mumbai, Chennai, Kolkata, Bengaluru, Hyderabad, Ahmedabad,
 * Pune, Jaipur, Lucknow, Chandigarh, Kochi, Indore, Nagpur, Surat, Kanpur,
 * Patna, Bhopal, Coimbatore, Visakhapatnam.
 */
const METRO_PREFIXES = new Set([
  '11', '40', '60', '70', '56', '50', '38', '41', '30', '22',
  '16', '68', '45', '44', '39', '20', '80', '46', '64', '53',
]);

/** Box + cushioning buffer added to the bare print weight (grams). */
const PACKAGING_GRAMS = numEnv('SNKB_DELIVERY_PACKAGING_G', 150);
/** Volumetric divisor (Indian courier standard): L×W×H(cm) / 5000 = kg. */
const VOLUMETRIC_DIVISOR = 5000;
/** First-500 g slab rates by zone (₹). */
const BASE_500G = {
  metro: numEnv('SNKB_DELIVERY_METRO_BASE', 59),
  regional: numEnv('SNKB_DELIVERY_ROI_BASE', 79),
};
/** Each additional 500 g slab by zone (₹). */
const EXTRA_500G = {
  metro: numEnv('SNKB_DELIVERY_METRO_EXTRA', 25),
  regional: numEnv('SNKB_DELIVERY_ROI_EXTRA', 35),
};
/** Order print-total (₹) at or above which delivery is free. */
const FREE_SHIPPING_THRESHOLD = numEnv('SNKB_FREE_SHIPPING_THRESHOLD', 499);

/** Customer flat delivery tiers (₹) to guarantee healthy profit margins */
const FLAT_DELIVERY_BASE = numEnv('SNKB_DELIVERY_FLAT_BASE', 99);
const FLAT_DELIVERY_TIER2 = numEnv('SNKB_DELIVERY_FLAT_TIER2', 149);
const FLAT_DELIVERY_TIER3 = numEnv('SNKB_DELIVERY_FLAT_TIER3', 199);

/**
 * Maps raw courier cost to profitable customer delivery fee:
 * - Cost <= 99   -> ₹99  (Standard Flat delivery, rest kept as profit)
 * - Cost > 99 && <= 149 -> ₹149 (Heavy / Regional / Express tier)
 * - Cost > 149   -> ₹199 (Overweight / Special cargo tier)
 */
function calculateCustomerDeliveryFee(rawCost) {
  const cost = Number(rawCost) || 0;
  if (cost <= 0) return 0;
  if (cost <= FLAT_DELIVERY_BASE) return FLAT_DELIVERY_BASE;
  if (cost <= FLAT_DELIVERY_TIER2) return FLAT_DELIVERY_TIER2;
  if (cost <= FLAT_DELIVERY_TIER3) return FLAT_DELIVERY_TIER3;
  return Math.ceil(cost / 50) * 50 - 1; // e.g. 249 for extreme weights
}

/** True for a well-formed 6-digit Indian PIN code. */
function isValidPincode(pincode) {
  return typeof pincode === 'string' && PINCODE_RE.test(pincode.trim());
}

/** Normalize user input (`' 110001 '` → `'110001'`); garbage → null. */
function normalizePincode(pincode) {
  if (typeof pincode !== 'string') return null;
  const trimmed = pincode.trim();
  return PINCODE_RE.test(trimmed) ? trimmed : null;
}

/** 'metro' for hub prefixes, otherwise 'regional'. */
function zoneForPincode(pincode) {
  return METRO_PREFIXES.has(String(pincode).slice(0, 2)) ? 'metro' : 'regional';
}

function zoneLabel(zone) {
  return zone === 'metro' ? 'Metro hub' : 'Rest of India';
}

/**
 * Volumetric weight (g) from bounding-box dims (mm):
 * (x/10)(y/10)(z/10)/5000 kg → mm³/5000 g.
 */
function volumetricWeightG(dimensionsMm) {
  if (!dimensionsMm) return 0;
  const x = Number(dimensionsMm.x) || 0;
  const y = Number(dimensionsMm.y) || 0;
  const z = Number(dimensionsMm.z) || 0;
  if (x <= 0 || y <= 0 || z <= 0) return 0;
  return (x * y * z) / VOLUMETRIC_DIVISOR;
}

/**
 * Chargeable parcel weight (g, 1 decimal).
 */
function chargeableWeightG(weightG, dimensionsMm) {
  const parcel = (Number(weightG) || 0) + PACKAGING_GRAMS;
  return Math.round(Math.max(parcel, volumetricWeightG(dimensionsMm)) * 10) / 10;
}

/**
 * Slab charge (₹) for a chargeable weight in a zone.
 */
function slabCharge(chargeableG, zone) {
  const slabs = Math.max(1, Math.ceil(chargeableG / 500));
  return BASE_500G[zone] + (slabs - 1) * EXTRA_500G[zone];
}

/**
 * Full delivery quote. Throws `{ code: 'invalid_pincode' }` on bad PIN input
 * so Express can map it straight to HTTP 400.
 *
 * @param {object} input
 * @param {number} input.weightG bare print weight (g)
 * @param {{x,y,z}} input.dimensionsMm bounding box (mm)
 * @param {string} input.pincode destination PIN
 * @param {number} input.orderValue print-total (₹) for the free-shipping check
 * @returns {{ pincode, zone, zoneLabel, parcelWeightG, volumetricWeightG,
 *   chargeableWeightG, deliveryCharge, freeShipping, grandTotal }}
 */
function calculateDelivery({ weightG, dimensionsMm, pincode, orderValue, rawCourierCost = null }) {
  const pin = normalizePincode(pincode);
  if (!pin) {
    const err = new Error(`Invalid delivery pincode: ${JSON.stringify(pincode)}. Expected 6 digits.`);
    err.code = 'invalid_pincode';
    throw err;
  }

  const zone = zoneForPincode(pin);
  const parcelWeightG = Math.round(((Number(weightG) || 0) + PACKAGING_GRAMS) * 10) / 10;
  const volumetricG = Math.round(volumetricWeightG(dimensionsMm) * 10) / 10;
  const chargeableWeightG = Math.max(parcelWeightG, volumetricG);
  const freeShipping = (Number(orderValue) || 0) >= FREE_SHIPPING_THRESHOLD;
  
  // Internal courier cost from courier API or slab calculation:
  const rawCost = rawCourierCost != null ? Number(rawCourierCost) : slabCharge(chargeableWeightG, zone);
  
  // Customer delivery charge based on the profit tier (Flat ₹99 base, ₹149 if >99, ₹199 if >149):
  const deliveryCharge = freeShipping ? 0 : calculateCustomerDeliveryFee(rawCost);

  return {
    pincode: pin,
    zone,
    zoneLabel: zoneLabel(zone),
    parcelWeightG,
    volumetricWeightG: volumetricG,
    chargeableWeightG,
    rawCourierCost: rawCost,
    deliveryCharge,
    profitMargin: freeShipping ? 0 : Math.max(0, deliveryCharge - rawCost),
    freeShipping,
    grandTotal: Math.round(((Number(orderValue) || 0) + deliveryCharge) * 100) / 100,
  };
}

module.exports = {
  PINCODE_RE,
  METRO_PREFIXES,
  PACKAGING_GRAMS,
  VOLUMETRIC_DIVISOR,
  BASE_500G,
  EXTRA_500G,
  FREE_SHIPPING_THRESHOLD,
  FLAT_DELIVERY_BASE,
  FLAT_DELIVERY_TIER2,
  FLAT_DELIVERY_TIER3,
  calculateCustomerDeliveryFee,
  isValidPincode,
  normalizePincode,
  zoneForPincode,
  zoneLabel,
  volumetricWeightG,
  chargeableWeightG,
  slabCharge,
  calculateDelivery,
};
