/**
 * IndexedDB Workspace Cache for SNKB 3D Studio.
 *
 * Persists the user's uploaded 3D model buffer and active print settings so
 * refreshing the browser automatically restores their 3D scene, material presets,
 * and slicer quotation state without re-uploading.
 */

const DB_NAME = 'snkb_3d_workspace_v1';
const DB_VERSION = 1;
const STORE_NAME = 'active_workspace';
const CACHE_KEY = 'current_session';

function openDatabase() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
      return resolve(null);
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = (err) => {
        console.warn('[WorkspaceCache] IndexedDB open error:', err);
        resolve(null);
      };
    } catch (e) {
      console.warn('[WorkspaceCache] IndexedDB initialization failed:', e);
      resolve(null);
    }
  });
}

/**
 * Persist the current 3D model buffer and print configuration.
 *
 * @param {object} params
 * @param {ArrayBuffer|Blob|null} params.buffer Binary model data
 * @param {string} params.fileName File name (e.g. "dragon.stl")
 * @param {string} params.fileType "stl" or "3mf"
 * @param {object} params.settings Material, profile, quantity, scale, addOns
 * @param {string} [params.designUrl] Optional catalog design url if loaded from catalog
 */
export async function saveWorkspaceModel({ buffer, fileName, fileType, settings, designUrl }) {
  const db = await openDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const entry = {
        buffer: buffer || null,
        fileName: fileName || 'model.stl',
        fileType: fileType || 'stl',
        settings: settings || {},
        designUrl: designUrl || null,
        savedAt: Date.now(),
      };

      const putReq = store.put(entry, CACHE_KEY);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Load the cached 3D workspace model and settings.
 *
 * @returns {Promise<object|null>}
 */
export async function loadWorkspaceModel() {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(CACHE_KEY);

      getReq.onsuccess = () => {
        const res = getReq.result || null;
        resolve(res);
      };
      getReq.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Update only the print settings in the current cache.
 *
 * @param {object} newSettings
 */
export async function saveWorkspaceSettings(newSettings) {
  const current = await loadWorkspaceModel();
  if (!current) return false;

  return saveWorkspaceModel({
    ...current,
    settings: {
      ...current.settings,
      ...newSettings,
    },
  });
}

/**
 * Clear the cached workspace session.
 */
export async function clearWorkspaceCache() {
  const db = await openDatabase();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const delReq = store.delete(CACHE_KEY);

      delReq.onsuccess = () => resolve(true);
      delReq.onerror = () => resolve(false);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(false);
    }
  });
}
