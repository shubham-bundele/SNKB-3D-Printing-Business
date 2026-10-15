'use strict';

/**
 * Supabase Postgres persistence layer (@supabase/supabase-js).
 *
 * Migrated from SQLite to Supabase for Vercel Serverless compatibility.
 * Connects to Supabase Postgres when SUPABASE_URL and SUPABASE_ANON_KEY
 * (or SUPABASE_SERVICE_ROLE_KEY) are configured. Falls back gracefully to an
 * in-memory store during offline testing or local development without credentials.
 *
 * Environment variables:
 *   - SUPABASE_URL             : Project URL (e.g. https://xxx.supabase.co)
 *   - SUPABASE_ANON_KEY        : Public anon key
 *   - SUPABASE_SERVICE_ROLE_KEY: Optional privileged key for admin operations
 */

const { createClient } = require('@supabase/supabase-js');

/** Canonical order lifecycle. Enforced by both DB CHECK and API validation. */
const ORDER_STATUSES = ['Pending', 'Slicing', 'Printing', 'Completed', 'Shipped', 'Cancelled'];

/** New orders always start here. */
const DEFAULT_ORDER_STATUS = 'Pending';

let supabaseClient = null;

function getSupabaseClient() {
  if (process.env.SNKB_DB_PATH) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

/** True when `status` is one of the allowed lifecycle values. */
function isValidStatus(status) {
  return typeof status === 'string' && ORDER_STATUSES.includes(status);
}

/** Canonical payment modes. Prepaid = collected at checkout; COD = cash on dispatch. */
const PAYMENT_MODES = ['Prepaid', 'COD'];
const DEFAULT_PAYMENT_MODE = 'Prepaid';

/** True when `mode` is a known payment mode. */
function isValidPaymentMode(mode) {
  return typeof mode === 'string' && PAYMENT_MODES.includes(mode);
}

/** Parse the stored JSON `dimensions_xyz` column defensively. */
function parseDimensions(dimensionsJson) {
  if (!dimensionsJson) return null;
  if (typeof dimensionsJson === 'object') return dimensionsJson;
  try {
    return JSON.parse(dimensionsJson);
  } catch {
    return null;
  }
}

/** Map a raw Postgres row to the camelCase shape consumed by the API. */
function serializeOrder(row) {
  if (!row) return null;
  // Support fields may also arrive via notes JSON (pre-migration rows).
  let notesMeta = null;
  if (row.notes && typeof row.notes === 'string') {
    try {
      const parsed = JSON.parse(row.notes);
      if (parsed && typeof parsed === 'object' && (parsed.supportWeightGrams != null || parsed.supportsEnabled != null)) {
        notesMeta = parsed;
      }
    } catch { /* plain-text notes */ }
  }
  return {
    id: Number(row.id),
    customerName: row.customer_name,
    customerEmail: row.customer_email ?? null,
    notes: row.notes ?? null,
    color: row.color ?? 'Concrete Grey',
    fileName: row.file_name,
    filePath: row.file_path,
    volumeMm3: row.volume_mm3 !== null ? Number(row.volume_mm3) : null,
    weightG: row.weight_g !== null ? Number(row.weight_g) : null,
    partWeightG: row.part_weight_g != null ? Number(row.part_weight_g) : (notesMeta?.partWeightGrams != null ? Number(notesMeta.partWeightGrams) : null),
    supportWeightG: row.support_weight_g != null ? Number(row.support_weight_g) : (notesMeta?.supportWeightGrams != null ? Number(notesMeta.supportWeightGrams) : 0),
    supportsEnabled: row.supports_enabled != null ? Boolean(row.supports_enabled) : (notesMeta?.supportsEnabled != null ? Boolean(notesMeta.supportsEnabled) : true),
    totalWeightG: row.total_weight_g != null ? Number(row.total_weight_g) : null,
    material: row.material ?? notesMeta?.material ?? 'pla',
    layerHeightMm: row.layer_height_mm != null ? Number(row.layer_height_mm) : (notesMeta?.layerHeightMm != null ? Number(notesMeta.layerHeightMm) : null),
    dimensions: parseDimensions(row.dimensions_xyz),
    dimensionsXyz: typeof row.dimensions_xyz === 'string' ? row.dimensions_xyz : JSON.stringify(row.dimensions_xyz),
    dimensionsMm: parseDimensions(row.dimensions_mm) || null,
    quotedPrice: row.quoted_price !== null ? Number(row.quoted_price) : null,
    deliveryPincode: row.delivery_pincode ?? null,
    deliveryZone: row.delivery_zone ?? null,
    deliveryCharge: row.delivery_charge !== null && row.delivery_charge !== undefined
      ? Number(row.delivery_charge)
      : null,
    grandTotal: row.grand_total !== null && row.grand_total !== undefined
      ? Number(row.grand_total)
      : null,
    paymentMode: row.payment_mode ?? DEFAULT_PAYMENT_MODE,
    paymentUtr: row.payment_utr ?? null,
    courierTrackingUrl: row.courier_tracking_url ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

const fs = require('fs');
const path = require('path');
const os = require('os');

function getLocalStorePath() {
  if (process.env.SNKB_LOCAL_STORE_PATH) return process.env.SNKB_LOCAL_STORE_PATH;
  if (process.env.SNKB_DB_PATH) return `${process.env.SNKB_DB_PATH}.json`;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'local_orders.json');
  return path.join(__dirname, '..', '..', 'data', 'local_orders.json');
}

function loadLocalOrders() {
  try {
    const storePath = getLocalStorePath();
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.orders)) {
        const maxId = parsed.orders.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0);
        return {
          orders: parsed.orders,
          autoId: Math.max(Number(parsed.autoId) || 1, maxId + 1),
        };
      }
    }
  } catch {
    // Fall back to clean memory state
  }
  return { orders: [], autoId: 1 };
}

function saveLocalOrders(store) {
  try {
    const storePath = getLocalStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify({ orders: store.orders, autoId: store.autoId }, null, 2), 'utf8');
  } catch {
    // Best-effort write
  }
}

const DEFAULT_SPOOLS = [
  { id: 1, material: 'Tough PLA+', color_name: 'Concrete Grey', hex_code: '#8E9296', remaining_grams: 850.0, is_active: true },
  { id: 2, material: 'Tough PLA+', color_name: 'Carbon Black', hex_code: '#22252a', remaining_grams: 1250.0, is_active: true },
  { id: 3, material: 'Tough PLA+', color_name: 'Signal Orange', hex_code: '#f97316', remaining_grams: 420.0, is_active: true },
  { id: 4, material: 'Tough PLA+', color_name: 'Cyber Emerald', hex_code: '#10b981', remaining_grams: 310.0, is_active: true },
  { id: 5, material: 'Tough PLA+', color_name: 'Arctic White', hex_code: '#f8fafc', remaining_grams: 950.0, is_active: true },
  { id: 6, material: 'Tough PLA+', color_name: 'Translucent Cyan', hex_code: '#06b6d4', remaining_grams: 35.0, is_active: true },
  { id: 7, material: 'Tough PLA+', color_name: 'Crimson Red', hex_code: '#dc2626', remaining_grams: 600.0, is_active: true },
  { id: 8, material: 'Tough PLA+', color_name: 'Cobalt Navy', hex_code: '#2563eb', remaining_grams: 550.0, is_active: true },
  { id: 9, material: 'Tough PLA+', color_name: 'Silk Gold', hex_code: '#d97706', remaining_grams: 480.0, is_active: true },
  { id: 10, material: 'Tough PLA+', color_name: 'Cyber Purple', hex_code: '#9333ea', remaining_grams: 220.0, is_active: true },
  { id: 11, material: 'Tough PLA+', color_name: 'Tactical Olive', hex_code: '#4d7c0f', remaining_grams: 340.0, is_active: true },
  { id: 12, material: 'Tough PLA+', color_name: 'Titanium Silver', hex_code: '#94a3b8', remaining_grams: 42.0, is_active: true },
  { id: 13, material: 'Flexible TPU 95A', color_name: 'Stealth Black', hex_code: '#1E2229', remaining_grams: 400.0, is_active: true },
  { id: 14, material: 'Flexible TPU 95A', color_name: 'Safety Orange', hex_code: '#FF5500', remaining_grams: 160.0, is_active: true },
  { id: 15, material: 'Flexible TPU 95A', color_name: 'Neon Green', hex_code: '#39FF14', remaining_grams: 28.0, is_active: true },
];

function serializeSpool(row) {
  if (!row) return null;
  const remGrams = row.remaining_grams !== undefined ? Number(row.remaining_grams) : Number(row.remainingGrams);
  const colName = row.color_name || row.colorName;
  const hx = row.hex_code || row.hexCode;
  const act = row.is_active !== undefined ? Boolean(row.is_active) : (row.isActive !== undefined ? Boolean(row.isActive) : true);
  return {
    id: Number(row.id),
    material: row.material,
    colorName: colName,
    color_name: colName,
    hexCode: hx,
    hex_code: hx,
    remainingGrams: remGrams,
    remaining_grams: remGrams,
    isActive: act,
    is_active: act,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function getLocalSpoolsPath() {
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'local_spools.json');
  return path.join(__dirname, '..', '..', 'data', 'local_spools.json');
}

function loadLocalSpools() {
  try {
    const spoolsPath = getLocalSpoolsPath();
    if (fs.existsSync(spoolsPath)) {
      const parsed = JSON.parse(fs.readFileSync(spoolsPath, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SPOOLS.map((s) => ({ ...s }));
}

function saveLocalSpools(spools) {
  try {
    const spoolsPath = getLocalSpoolsPath();
    const dir = path.dirname(spoolsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(spoolsPath, JSON.stringify(spools, null, 2), 'utf8');
  } catch {}
}

// ---------------------------------------------------------------------------
// Local / In-Memory Fallback Store (persisted to data/local_orders.json)
// ---------------------------------------------------------------------------
const initialLocal = loadLocalOrders();
const memoryStore = {
  orders: initialLocal.orders,
  autoId: initialLocal.autoId,
  spools: loadLocalSpools(),
  save() {
    saveLocalOrders(this);
    saveLocalSpools(this.spools);
  },
  reset() {
    this.orders = [];
    this.autoId = 1;
    this.spools = DEFAULT_SPOOLS.map((s) => ({ ...s }));
    this.save();
  },
};

/**
 * Insert a new order into Supabase (or in-memory fallback).
 */
async function createOrder(order) {
  const status = isValidStatus(order.status) ? order.status : DEFAULT_ORDER_STATUS;
  const customerName =
    order.customerName && String(order.customerName).trim()
      ? String(order.customerName).trim().slice(0, 120)
      : 'Guest';
  const customerEmail =
    order.customerEmail && String(order.customerEmail).trim()
      ? String(order.customerEmail).trim().slice(0, 160)
      : null;
  const notes =
    order.notes && String(order.notes).trim()
      ? String(order.notes).trim().slice(0, 500)
      : null;
  const color =
    order.color && String(order.color).trim()
      ? String(order.color).trim().slice(0, 50)
      : 'Concrete Grey';

  const row = {
    customer_name: customerName,
    customer_email: customerEmail,
    notes,
    color,
    file_name: order.fileName ?? null,
    file_path: order.filePath ?? null,
    volume_mm3: order.volumeMm3 ?? null,
    weight_g: order.weightG ?? null,
    part_weight_g: order.partWeightG ?? order.partWeightGrams ?? null,
    support_weight_g: order.supportWeightG ?? order.supportWeightGrams ?? 0,
    supports_enabled: order.supportsEnabled ?? order.supports_enabled ?? true,
    total_weight_g: order.totalWeightG ?? order.totalWeightGrams ?? order.weightG ?? null,
    material: order.material ? String(order.material).slice(0, 20) : 'pla',
    layer_height_mm: order.layerHeightMm ?? order.layer_height ?? null,
    dimensions_xyz: order.dimensions ? JSON.stringify(order.dimensions) : null,
    dimensions_mm: order.dimensionsMm ? JSON.stringify(order.dimensionsMm) : (order.dimensions ? JSON.stringify(order.dimensions) : null),
    quoted_price: order.quotedPrice ?? null,
    status,
  };

  const client = getSupabaseClient();
  if (client) {
    let { data, error } = await client
      .from('orders')
      .insert(row)
      .select()
      .single();

    // Pre-migration Supabase (no support columns yet): retry without new cols,
    // stashing the split inside notes JSON so no data is lost.
    if (error && /column|part_weight|support_weight|supports_enabled|material|layer_height|dimensions_mm/i.test(error.message || '')) {
      const fallbackNotes = JSON.stringify({
        ...(notes ? { rawNotes: notes } : {}),
        partWeightGrams: row.part_weight_g,
        supportWeightGrams: row.support_weight_g,
        supportsEnabled: row.supports_enabled,
        material: row.material,
        layerHeightMm: row.layer_height_mm,
      });
      const legacyRow = {
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        notes: fallbackNotes,
        color: row.color,
        file_name: row.file_name,
        file_path: row.file_path,
        volume_mm3: row.volume_mm3,
        weight_g: row.weight_g,
        dimensions_xyz: row.dimensions_xyz,
        quoted_price: row.quoted_price,
        status,
      };
      const retry = await client.from('orders').insert(legacyRow).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('[supabase] createOrder error:', error.message);
      throw new Error(`Supabase createOrder failed: ${error.message}`);
    }
    return serializeOrder(data);
  }

  // Fallback in-memory insert
  const simulatedRow = {
    ...row,
    id: memoryStore.autoId++,
    created_at: new Date().toISOString(),
  };
  memoryStore.orders.push(simulatedRow);
  memoryStore.save();
  return serializeOrder(simulatedRow);
}

/**
 * Query all orders, newest first.
 */
async function listOrders() {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (error) {
      console.error('[supabase] listOrders error:', error.message);
      return [];
    }
    return (data || []).map(serializeOrder);
  }

  // Fallback in-memory list
  return [...memoryStore.orders]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)
    .map(serializeOrder);
}

/**
 * Retrieve a single order by primary key ID.
 */
async function getOrderById(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .select('*')
      .eq('id', numericId)
      .maybeSingle();

    if (error) {
      console.error(`[supabase] getOrderById(${id}) error:`, error.message);
      return null;
    }
    return serializeOrder(data);
  }

  // Fallback in-memory lookup
  const found = memoryStore.orders.find((o) => o.id === numericId);
  return serializeOrder(found);
}

/**
 * Returns a sanitized order for public tracking views (omitting internal file_path).
 */
async function getPublicOrderById(id) {
  const order = await getOrderById(id);
  if (!order) return null;
  const { filePath, ...publicOrder } = order;
  return publicOrder;
}

/**
 * Confirms and updates an order with customer details, notes, and color.
 * Accepts an optional pre-computed `delivery` object
 * ({ pincode, zone, charge }) — persisted with a grand total so tracking,
 * admin, and receipts all read one authoritative payable amount.
 * Accepts an optional `paymentMode` ('Prepaid' | 'COD', defaults to existing).
 * Accepts an optional `paymentUtr` / `utr` (12-digit transaction ID for UPI).
 */
async function confirmOrder({ orderId, customerName, email, notes, color, delivery, paymentMode, paymentUtr, utr, material, layerHeightMm, supportsEnabled, partWeightGrams, supportWeightGrams, totalWeightGrams, dimensionsMm }) {
  const numericId = Number(orderId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, reason: 'invalid_id' };
  }

  const existing = await getOrderById(numericId);
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  const trimmedName =
    customerName && String(customerName).trim()
      ? String(customerName).trim().slice(0, 120)
      : existing.customerName;

  const trimmedEmail =
    email && String(email).trim()
      ? String(email).trim().slice(0, 160)
      : existing.customerEmail;

  const trimmedNotes =
    notes !== undefined
      ? notes && String(notes).trim()
        ? String(notes).trim().slice(0, 500)
        : null
      : existing.notes;

  const chosenColor =
    color && String(color).trim()
      ? String(color).trim().slice(0, 50)
      : existing.color || 'Concrete Grey';

  const chosenPaymentMode = isValidPaymentMode(paymentMode)
    ? paymentMode
    : existing.paymentMode || DEFAULT_PAYMENT_MODE;

  const candidateUtr = paymentUtr || utr;
  const chosenUtr =
    candidateUtr && String(candidateUtr).trim()
      ? String(candidateUtr).trim().slice(0, 60)
      : existing.paymentUtr ?? null;

  // Optional delivery settlement (validated + computed server-side by the route).
  let deliveryPincode = existing.deliveryPincode ?? null;
  let deliveryZone = existing.deliveryZone ?? null;
  let deliveryCharge = existing.deliveryCharge ?? null;
  let grandTotal = existing.grandTotal ?? null;
  if (delivery && typeof delivery === 'object') {
    if (typeof delivery.pincode === 'string' && delivery.pincode.trim()) {
      deliveryPincode = delivery.pincode.trim().slice(0, 10);
    }
    if (typeof delivery.zone === 'string' && delivery.zone.trim()) {
      deliveryZone = delivery.zone.trim().slice(0, 20);
    }
    if (Number.isFinite(Number(delivery.charge)) && Number(delivery.charge) >= 0) {
      deliveryCharge = Math.round(Number(delivery.charge) * 100) / 100;
      const base = Number(existing.quotedPrice) || 0;
      grandTotal = Math.round((base + deliveryCharge) * 100) / 100;
    }
  }

  const client = getSupabaseClient();
  const supportUpdate = {
    customer_name: trimmedName,
    customer_email: trimmedEmail,
    notes: trimmedNotes,
    color: chosenColor,
    payment_mode: chosenPaymentMode,
    payment_utr: chosenUtr,
    delivery_pincode: deliveryPincode,
    delivery_zone: deliveryZone,
    delivery_charge: deliveryCharge,
    grand_total: grandTotal,
    ...(material != null ? { material: String(material).slice(0, 20) } : {}),
    ...(layerHeightMm != null && Number(layerHeightMm) > 0 ? { layer_height_mm: Number(layerHeightMm) } : {}),
    ...(supportsEnabled != null ? { supports_enabled: Boolean(supportsEnabled) } : {}),
    ...(partWeightGrams != null && Number(partWeightGrams) >= 0 ? { part_weight_g: Number(partWeightGrams) } : {}),
    ...(supportWeightGrams != null && Number(supportWeightGrams) >= 0 ? { support_weight_g: Number(supportWeightGrams) } : {}),
    ...(totalWeightGrams != null && Number(totalWeightGrams) >= 0 ? { total_weight_g: Number(totalWeightGrams) } : {}),
    ...(dimensionsMm ? { dimensions_mm: JSON.stringify(dimensionsMm) } : {}),
  };
  if (client) {
    let { data, error } = await client
      .from('orders')
      .update(supportUpdate)
      .eq('id', numericId)
      .select()
      .maybeSingle();

    // Pre-migration fallback: strip support cols and stash in notes JSON.
    if (error && /column|part_weight|support_weight|supports_enabled|material|layer_height|dimensions_mm/i.test(error.message || '')) {
      const { material: _m, layer_height_mm: _l, supports_enabled: _s, part_weight_g: _p, support_weight_g: _sw, total_weight_g: _t, dimensions_mm: _d, ...legacyUpdate } = supportUpdate;
      try {
        legacyUpdate.notes = JSON.stringify({
          ...(trimmedNotes ? { rawNotes: trimmedNotes } : {}),
          partWeightGrams: supportUpdate.part_weight_g ?? null,
          supportWeightGrams: supportUpdate.support_weight_g ?? 0,
          supportsEnabled: supportUpdate.supports_enabled ?? true,
          material: supportUpdate.material ?? existing.material ?? 'pla',
          layerHeightMm: supportUpdate.layer_height_mm ?? null,
        });
      } catch { /* keep notes */ }
      const retry = await client.from('orders').update(legacyUpdate).eq('id', numericId).select().maybeSingle();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error(`[supabase] confirmOrder(${numericId}) error:`, error.message);
      return { ok: false, reason: 'database_error' };
    }
    const publicOrder = serializeOrder(data);
    delete publicOrder.filePath;
    return { ok: true, order: publicOrder };
  }

  // Fallback in-memory update
  const row = memoryStore.orders.find((o) => o.id === numericId);
  if (!row) return { ok: false, reason: 'not_found' };
  row.customer_name = trimmedName;
  row.customer_email = trimmedEmail;
  row.notes = trimmedNotes;
  row.color = chosenColor;
  row.payment_mode = chosenPaymentMode;
  row.payment_utr = chosenUtr;
  row.delivery_pincode = deliveryPincode;
  row.delivery_zone = deliveryZone;
  row.delivery_charge = deliveryCharge;
  row.grand_total = grandTotal;
  if (supportUpdate.material != null) row.material = supportUpdate.material;
  if (supportUpdate.layer_height_mm != null) row.layer_height_mm = supportUpdate.layer_height_mm;
  if (supportUpdate.supports_enabled != null) row.supports_enabled = supportUpdate.supports_enabled;
  if (supportUpdate.part_weight_g != null) row.part_weight_g = supportUpdate.part_weight_g;
  if (supportUpdate.support_weight_g != null) row.support_weight_g = supportUpdate.support_weight_g;
  if (supportUpdate.total_weight_g != null) row.total_weight_g = supportUpdate.total_weight_g;
  if (supportUpdate.dimensions_mm != null) row.dimensions_mm = supportUpdate.dimensions_mm;
  memoryStore.save();

  return { ok: true, order: await getPublicOrderById(numericId) };
}

/**
 * Update the 12-digit UTR / Transaction ID on an existing order.
 */
async function updateOrderUtr(orderId, utr) {
  const numericId = Number(orderId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, reason: 'invalid_id' };
  }

  const existing = await getOrderById(numericId);
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  const trimmedUtr = utr && String(utr).trim() ? String(utr).trim().slice(0, 60) : null;

  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .update({ payment_utr: trimmedUtr })
      .eq('id', numericId)
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[supabase] updateOrderUtr(${numericId}) error:`, error.message);
      return { ok: false, reason: 'database_error' };
    }
    const publicOrder = serializeOrder(data);
    delete publicOrder.filePath;
    return { ok: true, order: publicOrder };
  }

  // Fallback in-memory update
  const row = memoryStore.orders.find((o) => o.id === numericId);
  if (!row) return { ok: false, reason: 'not_found' };
  row.payment_utr = trimmedUtr;
  memoryStore.save();

  return { ok: true, order: await getPublicOrderById(numericId) };
}

/**
 * Update an order's status and optional courier tracking URL.
 */
async function updateOrderStatus(id, status, options = {}) {
  if (!isValidStatus(status)) {
    return { ok: false, reason: 'invalid_status' };
  }

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, reason: 'not_found' };
  }

  const candidateCourierUrl = options && (options.courierTrackingUrl !== undefined ? options.courierTrackingUrl : options.trackingUrl);
  const updatePayload = { status };
  if (candidateCourierUrl !== undefined) {
    updatePayload.courier_tracking_url = candidateCourierUrl && String(candidateCourierUrl).trim()
      ? String(candidateCourierUrl).trim().slice(0, 500)
      : null;
  }

  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .update(updatePayload)
      .eq('id', numericId)
      .select()
      .maybeSingle();

    if (error || !data) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: true, order: serializeOrder(data) };
  }

  // Fallback in-memory status update
  const row = memoryStore.orders.find((o) => o.id === numericId);
  if (!row) return { ok: false, reason: 'not_found' };
  row.status = status;
  if (candidateCourierUrl !== undefined) {
    row.courier_tracking_url = updatePayload.courier_tracking_url;
  }
  memoryStore.save();
  return { ok: true, order: serializeOrder(row) };
}

/**
 * Clear the file_path for one or more orders (e.g. after storage cleanup).
 */
async function clearOrderFilePaths(orderIds) {
  const ids = (Array.isArray(orderIds) ? orderIds : [orderIds])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) return 0;

  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .update({ file_path: null })
      .in('id', ids)
      .select('id');

    if (error) {
      console.error('[supabase] clearOrderFilePaths error:', error.message);
      return 0;
    }
    return data ? data.length : 0;
  }

  // Fallback in-memory
  let count = 0;
  for (const row of memoryStore.orders) {
    if (ids.includes(row.id)) {
      row.file_path = null;
      count++;
    }
  }
  if (count > 0) memoryStore.save();
  return count;
}

/**
 * Query orders that are Completed or Cancelled and still have a file_path.
 */
async function listOrdersForStorageCleanup() {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('orders')
      .select('*')
      .in('status', ['Completed', 'Cancelled'])
      .not('file_path', 'is', null)
      .neq('file_path', '');

    if (error) {
      console.error('[supabase] listOrdersForStorageCleanup error:', error.message);
      return [];
    }
    return (data || []).map(serializeOrder);
  }

  // Fallback in-memory
  return memoryStore.orders
    .filter((o) => (o.status === 'Completed' || o.status === 'Cancelled') && o.file_path)
    .map(serializeOrder);
}

/**
 * List all filament spools.
 */
async function listSpools() {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('filament_spools')
      .select('*')
      .order('id', { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map(serializeSpool);
    }
  }

  // In-memory / local fallback
  return memoryStore.spools.map(serializeSpool);
}

/**
 * Update remaining grams for a specific spool.
 */
async function updateSpoolRemaining(id, remainingGrams) {
  const numericGrams = Math.max(0, Number(remainingGrams));
  const numericId = Number(id);

  const client = getSupabaseClient();
  let updatedRow = null;

  if (client) {
    const { data, error } = await client
      .from('filament_spools')
      .update({
        remaining_grams: numericGrams,
        updated_at: new Date().toISOString(),
      })
      .eq('id', numericId)
      .select('*')
      .single();

    if (!error && data) {
      updatedRow = serializeSpool(data);
    } else if (error) {
      console.error('[supabase] updateSpoolRemaining error:', error.message);
    }
  }

  // Update memory / local disk
  const idx = memoryStore.spools.findIndex((s) => Number(s.id) === numericId);
  if (idx !== -1) {
    memoryStore.spools[idx].remaining_grams = numericGrams;
    memoryStore.spools[idx].updated_at = new Date().toISOString();
    memoryStore.save();
    if (!updatedRow) updatedRow = serializeSpool(memoryStore.spools[idx]);
  }

  return updatedRow;
}

/** Close client connection / cleanup */
function closeDatabase() {
  memoryStore.reset();
  supabaseClient = null;
}

module.exports = {
  ORDER_STATUSES,
  DEFAULT_ORDER_STATUS,
  PAYMENT_MODES,
  DEFAULT_PAYMENT_MODE,
  getSupabaseClient,
  isValidStatus,
  isValidPaymentMode,
  createOrder,
  listOrders,
  getOrderById,
  getPublicOrderById,
  confirmOrder,
  updateOrderUtr,
  updateOrderStatus,
  clearOrderFilePaths,
  listOrdersForStorageCleanup,
  listSpools,
  updateSpoolRemaining,
  closeDatabase,
  _memoryStore: memoryStore,
};

