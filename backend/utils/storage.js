const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ApiError = require('./ApiError');
const { sniffImageType, EXTENSIONS } = require('./imageType');

// Images are saved on the local disk under UPLOAD_DIR and served by app.js at /uploads.
// Each image is stored as { url, key }:
//   key: path inside UPLOAD_DIR, e.g. "products/66f1.../3b2a...png"
//   url: public path, e.g. "/uploads/products/66f1.../3b2a...png" (the app prefixes the API host)

const PUBLIC_PREFIX = '/uploads';

function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
}

// Turns a key into an absolute path, refusing anything that escapes the uploads folder.
function resolveKey(key) {
  const root = uploadRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return full;
}

// Writes an already-received image buffer to `folder` and returns { url, key }.
// The file name is random and the extension comes from the real file type,
// never from the name the client sent.
async function saveImage(buffer, folder) {
  const type = sniffImageType(buffer);
  if (!type) {
    throw new ApiError(415, 'UNSUPPORTED_IMAGE', 'Only JPEG, PNG or WebP images are allowed');
  }

  const key = path.posix.join(folder, `${crypto.randomUUID()}${EXTENSIONS[type]}`);
  const filePath = resolveKey(key);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer, { flag: 'wx' });

  return { url: `${PUBLIC_PREFIX}/${key}`, key };
}

// Best effort: a failed delete only leaves an orphaned file, so it never fails the request.
async function deleteImage(key) {
  if (!key) return;
  try {
    await fs.unlink(resolveKey(key));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[storage] could not delete ${key}: ${err.message}`);
  }
}

module.exports = { saveImage, deleteImage, uploadRoot, resolveKey, PUBLIC_PREFIX };
