'use strict';

/**
 * Persist accepted STL uploads to disk and Supabase Storage so admin "Download STL" /
 * slicing actions can retrieve the original geometry from anywhere.
 *
 * Local upload directory (default): <project-root>/uploads
 * Override with the `SNKB_UPLOAD_DIR` env var.
 *
 * Supabase Storage:
 * Uses bucket `SUPABASE_STORAGE_BUCKET` (default: 'models') when SUPABASE_URL
 * and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) are configured.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');
const DEFAULT_STORAGE_BUCKET = 'stl-uploads';

function resolveUploadDir() {
  if (process.env.VERCEL) {
    const tmpUploads = path.join(os.tmpdir(), 'uploads');
    try {
      if (!fs.existsSync(tmpUploads)) {
        fs.mkdirSync(tmpUploads, { recursive: true });
      }
    } catch {
      /* ignore */
    }
    return tmpUploads;
  }
  const override = process.env.SNKB_UPLOAD_DIR;
  return override && override.trim() ? override.trim() : DEFAULT_UPLOAD_DIR;
}

function resolveStorageBucket() {
  const override = process.env.SUPABASE_STORAGE_BUCKET;
  return override && override.trim() ? override.trim() : DEFAULT_STORAGE_BUCKET;
}

/** Strip path separators / unsafe characters and ensure a valid .stl or .3mf extension. */
function sanitizeFileName(originalName) {
  const base = path.basename(String(originalName || 'model.stl'));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'model.stl';
  const lower = safe.toLowerCase();
  if (lower.endsWith('.stl') || lower.endsWith('.3mf')) {
    return safe;
  }
  return `${safe}.stl`;
}

/** Compute a project-relative path when possible, otherwise an absolute path. */
function toStorablePath(absolutePath) {
  const relative = path.relative(PROJECT_ROOT, absolutePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return absolutePath;
}

/** Extract object key (e.g. 'uploads/...') from a URL, bucket path, or relative path. */
function extractStorageKey(filePath, bucketName) {
  if (!filePath || typeof filePath !== 'string') return null;
  const bucket = bucketName || resolveStorageBucket();
  let clean = filePath.trim();

  // If it's a URL, extract path after bucket name
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      const u = new URL(clean);
      clean = decodeURIComponent(u.pathname);
    } catch {
      /* ignore */
    }
  }

  // Strip bucket prefix if present
  const bucketPrefix = `${bucket}/`;
  const idx = clean.indexOf(bucketPrefix);
  if (idx !== -1) {
    clean = clean.slice(idx + bucketPrefix.length);
  }

  // Normalize slashes
  clean = clean.replace(/\\/g, '/');

  // Strip leading slashes
  clean = clean.replace(/^\/+/, '');

  return clean;
}

let supabaseClient = null;

function getSupabaseStorageClient() {
  if (process.env.SNKB_DISABLE_SUPABASE_STORAGE === '1') return null;
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

/**
 * Write an in-memory multer file to the local uploads directory.
 *
 * @param {{ buffer?: Buffer, originalname?: string }} file
 * @returns {{ absolutePath: string, relativePath: string, storedPath: string, storedName: string, storageProvider: 'local' } | null}
 */
function saveUpload(file) {
  if (!file || !file.buffer) {
    return null;
  }

  const uploadDir = resolveUploadDir();
  fs.mkdirSync(uploadDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unique = crypto.randomBytes(4).toString('hex');
  const storedName = `${timestamp}-${unique}-${sanitizeFileName(file.originalname)}`;
  const absolutePath = path.join(uploadDir, storedName);

  fs.writeFileSync(absolutePath, file.buffer);

  return {
    absolutePath,
    relativePath: toStorablePath(absolutePath),
    storedPath: toStorablePath(absolutePath),
    storedName,
    storageProvider: 'local',
  };
}

/**
 * Upload an STL buffer to Supabase Storage bucket.
 *
 * @param {Buffer} buffer
 * @param {string} fileName
 * @param {string} [bucketName]
 * @returns {Promise<{ storageUrl: string, bucket: string, key: string } | null>}
 */
async function uploadToSupabaseStorage(buffer, fileName, bucketName) {
  const supabase = getSupabaseStorageClient();
  if (!supabase) return null;

  const bucket = bucketName || resolveStorageBucket();
  const filePath = `uploads/${fileName}`;
  const is3mf = String(fileName || '').toLowerCase().endsWith('.3mf');
  const contentType = is3mf ? 'model/3mf' : 'model/stl';

  try {
    let uploadRes = await supabase.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadRes.error && String(uploadRes.error.message || '').toLowerCase().includes('not found')) {
      try {
        await supabase.storage.createBucket(bucket, { public: false });
        uploadRes = await supabase.storage
          .from(bucket)
          .upload(filePath, buffer, {
            contentType,
            upsert: true,
          });
      } catch {
        /* ignore createBucket failure */
      }
    }

    if (uploadRes.error) {
      console.warn(`[storage] Supabase Storage upload: ${uploadRes.error.message} (falling back to local disk)`);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return {
      storageUrl: urlData?.publicUrl || filePath,
      bucket,
      key: filePath,
    };
  } catch (err) {
    console.warn(`[storage] Supabase Storage exception: ${err.message} (falling back to local disk)`);
    return null;
  }
}

/**
 * Persists an STL file locally and syncs to Supabase Storage if configured.
 *
 * @param {{ buffer?: Buffer, originalname?: string }} file
 * @returns {Promise<{ absolutePath: string, relativePath: string, storedPath: string, storedName: string, storageProvider: 'supabase'|'local', publicUrl: string|null, key: string|null } | null>}
 */
async function saveUploadAsync(file) {
  const localResult = saveUpload(file);
  if (!localResult) return null;

  const supabaseResult = await uploadToSupabaseStorage(file.buffer, localResult.storedName);
  if (supabaseResult) {
    return {
      ...localResult,
      storedPath: supabaseResult.key,
      storageProvider: 'supabase',
      publicUrl: supabaseResult.storageUrl,
      bucket: supabaseResult.bucket,
      key: supabaseResult.key,
    };
  }

  return localResult;
}

/**
 * Generate a signed download URL from Supabase Storage for a stored 3D model.
 *
 * @param {string} filePath
 * @param {number} [expiresInSeconds=3600]
 * @param {string} [bucketName]
 * @returns {Promise<{ signedUrl: string, bucket: string, key: string, provider: 'supabase' } | null>}
 */
async function createSignedDownloadUrl(filePath, expiresInSeconds = 3600, bucketName) {
  const supabase = getSupabaseStorageClient();
  const bucket = bucketName || resolveStorageBucket();
  const key = extractStorageKey(filePath, bucket);

  if (!supabase || !key) return null;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);

    if (error) {
      console.warn(`[storage] createSignedUrl error for ${key}:`, error.message);
      return null;
    }

    return {
      signedUrl: data.signedUrl,
      bucket,
      key,
      provider: 'supabase',
    };
  } catch (err) {
    console.warn(`[storage] createSignedUrl exception:`, err.message);
    return null;
  }
}

/**
 * Delete a stored 3D file from Supabase Storage and local disk.
 *
 * @param {string} filePath
 * @param {string} [bucketName]
 * @returns {Promise<{ supabaseDeleted: boolean, localDeleted: boolean, key: string|null }>}
 */
async function deleteFromStorage(filePath, bucketName) {
  const bucket = bucketName || resolveStorageBucket();
  const key = extractStorageKey(filePath, bucket);
  const result = { supabaseDeleted: false, localDeleted: false, key };

  // 1. Delete from Supabase Storage
  const supabase = getSupabaseStorageClient();
  if (supabase && key) {
    try {
      const { data, error } = await supabase.storage.from(bucket).remove([key]);
      if (!error && data && data.length > 0) {
        result.supabaseDeleted = true;
      }
    } catch (err) {
      console.warn(`[storage] deleteFromStorage Supabase error:`, err.message);
    }
  }

  // 2. Delete from local disk if it exists
  const uploadDir = resolveUploadDir();
  const fileName = path.basename(filePath || '');
  if (fileName) {
    const localPath = path.join(uploadDir, fileName);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        result.localDeleted = true;
      } catch (err) {
        console.warn(`[storage] delete local file error:`, err.message);
      }
    }
  }

  return result;
}

module.exports = {
  DEFAULT_UPLOAD_DIR,
  DEFAULT_STORAGE_BUCKET,
  resolveUploadDir,
  resolveStorageBucket,
  sanitizeFileName,
  extractStorageKey,
  saveUpload,
  saveUploadAsync,
  uploadToSupabaseStorage,
  createSignedDownloadUrl,
  deleteFromStorage,
  getSupabaseStorageClient,
};
