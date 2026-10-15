'use strict';

const path = require('node:path');
const multer = require('multer');

/** Hard cap for uploaded STL payloads (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const storage = multer.memoryStorage();

/**
 * Only `.stl` and `.3mf` files are accepted. Rejected uploads raise an error carrying a
 * `status`/`code` so the global error handler can map it to HTTP 400.
 */
function fileFilter(req, file, cb) {
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (extension !== '.stl' && extension !== '.3mf') {
    const error = new Error('Only .stl and .3mf files are supported.');
    error.status = 400;
    error.code = 'invalid_file_type';
    return cb(error);
  }

  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

module.exports = { upload, MAX_FILE_SIZE_BYTES };
