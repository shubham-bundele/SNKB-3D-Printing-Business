'use strict';

/**
 * Production-ready Courier Integration Module for SNKB 3D Studio.
 *
 * Supports:
 * 1. Shiprocket Multi-Carrier API (Unified Delhivery, Blue Dart, DTDC, Xpressbees)
 * 2. Delhivery Direct API (Delhivery One REST API)
 * 3. Graceful Fallback / Dispatch Pending Mode: "Calculated at dispatch via Delhivery / Blue Dart"
 */

const { calculateCustomerDeliveryFee } = require('./deliveryCalculator');

const DEFAULT_PICKUP_PIN = process.env.SNKB_PICKUP_PINCODE || '452001'; // Default workshop hub (Indore, MP)

let shiprocketToken = null;
let shiprocketTokenExpiresAt = 0;

/**
 * Authenticates with Shiprocket API using email + password or uses pre-configured token.
 */
async function getShiprocketToken() {
  if (process.env.SHIPROCKET_TOKEN) {
    return process.env.SHIPROCKET_TOKEN;
  }

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) return null;

  // Use cached token if valid (expires in 24 hours, refresh 1 hour before)
  if (shiprocketToken && Date.now() < shiprocketTokenExpiresAt - 3600000) {
    return shiprocketToken;
  }

  try {
    const res = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      console.warn('[Shiprocket Auth] Login failed with status:', res.status);
      return null;
    }

    const data = await res.json();
    if (data.token) {
      shiprocketToken = data.token;
      shiprocketTokenExpiresAt = Date.now() + 23 * 3600 * 1000;
      return shiprocketToken;
    }
  } catch (err) {
    console.warn('[Shiprocket Auth Error]:', err.message);
  }
  return null;
}

/**
 * Queries Shiprocket Serviceability API for live courier rates.
 */
async function fetchShiprocketRates({ pickupPin, deliveryPin, weightG, cod = 0 }) {
  const token = await getShiprocketToken();
  if (!token) return null;

  const weightKg = Math.max(0.1, (weightG || 200) / 1000);
  const url = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${encodeURIComponent(
    pickupPin || DEFAULT_PICKUP_PIN
  )}&delivery_postcode=${encodeURIComponent(deliveryPin)}&weight=${weightKg}&cod=${cod ? 1 : 0}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.status === 200 && data.data && data.data.available_courier_companies) {
      const couriers = data.data.available_courier_companies.map((c) => ({
        id: c.courier_company_id,
        name: c.courier_name,
        rate: Number(c.rate) || 0,
        etd: c.etd,
        cod: c.cod === 1,
      }));

      // Sort by price ascending
      couriers.sort((a, b) => a.rate - b.rate);

      const cheapest = couriers[0];
      const blueDart = couriers.find((c) => /blue\s*dart/i.test(c.name));
      const delhivery = couriers.find((c) => /delhivery/i.test(c.name));

      return {
        provider: 'shiprocket',
        couriers,
        cheapest: cheapest || null,
        delhiveryRate: delhivery?.rate || null,
        blueDartRate: blueDart?.rate || null,
      };
    }
  } catch (err) {
    console.warn('[Shiprocket Rate Fetch Error]:', err.message);
  }
  return null;
}

/**
 * Queries Delhivery Direct API for live rates.
 */
async function fetchDelhiveryRates({ pickupPin, deliveryPin, weightG, cod = false }) {
  const token = process.env.DELHIVERY_API_TOKEN;
  if (!token) return null;

  const url = `https://track.delhivery.com/api/kinko/v1/invoice/charges/.json?md=S&ss=Delivered&d_pin=${encodeURIComponent(
    deliveryPin
  )}&o_pin=${encodeURIComponent(pickupPin || DEFAULT_PICKUP_PIN)}&cgm=${Math.round(weightG || 200)}&pt=${
    cod ? 'COD' : 'Pre-paid'
  }`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0] && data[0].total_amount) {
      return {
        provider: 'delhivery_direct',
        rate: Number(data[0].total_amount),
        chargeableWeightG: data[0].chargeable_weight,
      };
    }
  } catch (err) {
    console.warn('[Delhivery Direct Rate Fetch Error]:', err.message);
  }
  return null;
}

/**
 * Returns whether any real-time third-party courier provider is configured.
 */
function isCourierConfigured() {
  return Boolean(
    process.env.SHIPROCKET_TOKEN ||
    (process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) ||
    process.env.DELHIVERY_API_TOKEN
  );
}

/**
 * Returns active provider name or 'pending_dispatch'.
 */
function getActiveProvider() {
  if (process.env.SHIPROCKET_TOKEN || (process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD)) {
    return 'shiprocket';
  }
  if (process.env.DELHIVERY_API_TOKEN) {
    return 'delhivery';
  }
  return 'pending_dispatch';
}

/**
 * High-level Courier Estimate function.
 * If external credentials exist, queries real-time rates.
 * Otherwise returns the dispatch-pending status with Delhivery / Blue Dart branding.
 */
async function getCourierEstimate({
  pickupPin = DEFAULT_PICKUP_PIN,
  deliveryPin,
  weightG = 200,
  cod = false,
}) {
  if (isCourierConfigured()) {
    const active = getActiveProvider();
    if (active === 'shiprocket') {
      const sr = await fetchShiprocketRates({ pickupPin, deliveryPin, weightG, cod });
      if (sr && sr.cheapest) {
        const rawCost = sr.cheapest.rate;
        const customerFee = calculateCustomerDeliveryFee(rawCost);
        return {
          configured: true,
          provider: 'shiprocket',
          rawCost,
          charge: customerFee,
          profit: customerFee - rawCost,
          courierName: sr.cheapest.name,
          details: sr,
        };
      }
    } else if (active === 'delhivery') {
      const del = await fetchDelhiveryRates({ pickupPin, deliveryPin, weightG, cod });
      if (del && del.rate) {
        const rawCost = del.rate;
        const customerFee = calculateCustomerDeliveryFee(rawCost);
        return {
          configured: true,
          provider: 'delhivery',
          rawCost,
          charge: customerFee,
          profit: customerFee - rawCost,
          courierName: 'Delhivery Surface',
          details: del,
        };
      }
    }
  }

  // Default / Pending mode: flat ₹99 standard Pan-India delivery
  return {
    configured: false,
    provider: 'pending_dispatch',
    rawCost: null,
    charge: 99,
    message: 'Flat ₹99 Pan-India Delivery via Delhivery / Blue Dart',
    carriers: ['Delhivery', 'Blue Dart'],
  };
}

module.exports = {
  DEFAULT_PICKUP_PIN,
  isCourierConfigured,
  getActiveProvider,
  getShiprocketToken,
  fetchShiprocketRates,
  fetchDelhiveryRates,
  getCourierEstimate,
};
