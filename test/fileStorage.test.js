'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  sanitizeFileName,
  saveUpload,
  saveUploadAsync,
  uploadToSupabaseStorage,
} = require('../src/services/fileStorage');

const testDir = path.join(os.tmpdir(), `snkb-storage-test-${Date.now()}`);

test.before(() => {
  process.env.SNKB_UPLOAD_DIR = testDir;
});

test.after(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('sanitizeFileName removes directory traversal, special characters, and forces .stl', () => {
  assert.equal(sanitizeFileName('../../evil/path/sample.stl'), 'sample.stl');
  assert.equal(sanitizeFileName('my model (1) #final.stl'), 'my_model__1___final.stl');
  assert.equal(sanitizeFileName('noextension'), 'noextension.stl');
  assert.equal(sanitizeFileName(''), 'model.stl');
  assert.equal(sanitizeFileName(null), 'model.stl');
});

test('saveUpload writes file buffer to local upload directory', () => {
  const dummyBuffer = Buffer.from('solid test\nfacet normal 0 0 0\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test');
  const result = saveUpload({
    originalname: 'test-part.stl',
    buffer: dummyBuffer,
  });

  assert.ok(result);
  assert.ok(result.absolutePath.includes('test-part.stl'));
  assert.ok(fs.existsSync(result.absolutePath));
  assert.equal(fs.readFileSync(result.absolutePath).toString(), dummyBuffer.toString());
  assert.equal(result.storageProvider, 'local');
});

test('saveUpload returns null when no buffer provided', () => {
  assert.equal(saveUpload(null), null);
  assert.equal(saveUpload({}), null);
});

test('saveUploadAsync falls back gracefully to local storage when Supabase is unconfigured', async () => {
  // Ensure Supabase storage is disabled or not configured
  const oldUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;

  const dummyBuffer = Buffer.from('dummy-stl-data');
  const result = await saveUploadAsync({
    originalname: 'async-part.stl',
    buffer: dummyBuffer,
  });

  assert.ok(result);
  assert.ok(result.absolutePath);
  assert.ok(fs.existsSync(result.absolutePath));
  assert.equal(result.storageProvider, 'local');

  if (oldUrl) process.env.SUPABASE_URL = oldUrl;
});

test('extractStorageKey extracts clean object keys from URLs and relative paths', () => {
  const { extractStorageKey } = require('../src/services/fileStorage');
  assert.equal(extractStorageKey(null), null);
  assert.equal(extractStorageKey('uploads/test-model.stl'), 'uploads/test-model.stl');
  assert.equal(extractStorageKey('/uploads/test-model.stl'), 'uploads/test-model.stl');
  assert.equal(extractStorageKey('stl-uploads/uploads/test-model.stl'), 'uploads/test-model.stl');
  assert.equal(
    extractStorageKey('https://example.supabase.co/storage/v1/object/public/stl-uploads/uploads/model-123.stl'),
    'uploads/model-123.stl'
  );
  assert.equal(
    extractStorageKey('https://example.supabase.co/storage/v1/object/sign/stl-uploads/uploads/model-456.stl?token=abc'),
    'uploads/model-456.stl'
  );
});

test('deleteFromStorage unlinks local copy on disk', async () => {
  const { deleteFromStorage } = require('../src/services/fileStorage');
  const testFile = path.join(testDir, 'delete-me.stl');
  fs.writeFileSync(testFile, 'dummy data to be cleaned');
  assert.ok(fs.existsSync(testFile));

  const result = await deleteFromStorage(testFile);
  assert.equal(result.localDeleted, true);
  assert.equal(fs.existsSync(testFile), false);
});
