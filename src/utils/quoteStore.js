/**
 * src/utils/quoteStore.js
 *
 * Persistent Global Quote Store for SNKB 3D Studio.
 * Synchronizes quote state with window.__SNKB_QUOTE_STATE__ and IndexedDB (snkb_3d_studio).
 *
 * Ensures uploaded models, slicer settings, and calculated INR quote details
 * persist across viewport scrolling, tab switching, and page refreshes.
 */

const DB_NAME = 'snkb_3d_studio';
const DB_VERSION = 1;
const STORE_NAME = 'snkb_active_quote';
const ACTIVE_KEY = 'current_active_quote';

let dbPromise = null;

function getDb() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('[QuoteStore] IndexedDB open error, falling back to window memory');
          resolve(null);
        };
      } catch (err) {
        console.warn('[QuoteStore] IndexedDB initialization error:', err);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

/**
 * Save active quote state to window.__SNKB_QUOTE_STATE__ and IndexedDB.
 * @param {Object} state - Active quote state object
 */
export async function saveActiveQuote(state) {
  if (typeof window === 'undefined' || !state) return;

  const payload = {
    ...state,
    hasActiveModel: true,
    savedAt: Date.now(),
  };

  // 1. Fast in-memory cache
  window.__SNKB_QUOTE_STATE__ = payload;

  // 2. Dispatch custom event for immediate UI synchronization
  try {
    window.dispatchEvent(
      new CustomEvent('snkb:quote-state-changed', { detail: payload })
    );
  } catch (_) {}

  // 3. Asynchronously persist to IndexedDB (including binary STL ArrayBuffer if present)
  try {
    const db = await getDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(payload, ACTIVE_KEY);
    }
  } catch (err) {
    console.warn('[QuoteStore] Failed to write to IndexedDB:', err);
  }
}

/**
 * Load active quote state from window memory or IndexedDB.
 * @returns {Promise<Object|null>}
 */
export async function loadActiveQuote() {
  if (typeof window === 'undefined') return null;

  // 1. Check in-memory state first
  if (
    window.__SNKB_QUOTE_STATE__ &&
    window.__SNKB_QUOTE_STATE__.hasActiveModel
  ) {
    return window.__SNKB_QUOTE_STATE__;
  }

  // 2. Fall back to IndexedDB
  try {
    const db = await getDb();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(ACTIVE_KEY);
          req.onsuccess = () => {
            const data = req.result;
            if (data && data.hasActiveModel) {
              window.__SNKB_QUOTE_STATE__ = data;
              resolve(data);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    }
  } catch (err) {
    console.warn('[QuoteStore] Failed to load from IndexedDB:', err);
  }

  return null;
}

/**
 * Clear the active quote state when explicitly requested (e.g. "Clear / Upload New STL").
 */
export async function clearActiveQuote() {
  if (typeof window !== 'undefined') {
    window.__SNKB_QUOTE_STATE__ = null;
    try {
      window.dispatchEvent(new CustomEvent('snkb:quote-state-cleared'));
    } catch (_) {}

    try {
      const db = await getDb();
      if (db) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(ACTIVE_KEY);
      }
    } catch (err) {
      console.warn('[QuoteStore] Failed to clear IndexedDB:', err);
    }
  }
}

/**
 * Synchronous check for active quote in memory.
 */
export function hasActiveQuoteInMemory() {
  return typeof window !== 'undefined' &&
    Boolean(window.__SNKB_QUOTE_STATE__ && window.__SNKB_QUOTE_STATE__.hasActiveModel);
}

export function getActiveQuoteInMemory() {
  return typeof window !== 'undefined' ? window.__SNKB_QUOTE_STATE__ : null;
}
