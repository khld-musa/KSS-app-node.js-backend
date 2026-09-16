const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { sniffImageType } = require('../utils/imageType');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Files are held in memory until their real type is checked; only then does
// utils/storage.js write them to the local uploads folder.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 10 },
});

function requireImages(req, res, next) {
  const files = req.files ?? (req.file ? [req.file] : []);
  if (!files.length) {
    throw new ApiError(422, 'NO_FILE', 'Please attach an image');
  }
  for (const file of files) {
    if (!sniffImageType(file.buffer)) {
      throw new ApiError(415, 'UNSUPPORTED_IMAGE', 'Only JPEG, PNG or WebP images are allowed');
    }
  }
  next();
}

// One image in form field `field` -> req.file
const singleImage = (field) => [memoryUpload.single(field), requireImages];

// Up to `max` images in form field `field` -> req.files
const imageArray = (field, max) => [memoryUpload.array(field, max), requireImages];

module.exports = { singleImage, imageArray, MAX_IMAGE_BYTES };
