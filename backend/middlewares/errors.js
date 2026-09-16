const ApiError = require('../utils/ApiError');

// Translates anything thrown by the API into { success: false, error: { code, message } }.
module.exports = (err, req, res, next) => {
  let error = err;

  if (!(err instanceof ApiError)) {
    if (err.name === 'CastError') {
      error = new ApiError(400, 'INVALID_ID', `Invalid ${err.path}`);
    } else if (err.name === 'ValidationError') {
      const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
      error = new ApiError(422, 'VALIDATION_ERROR', details[0]?.message || 'Invalid data', details);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || 'value';
      error = new ApiError(409, 'DUPLICATE', `${field} already exists`);
    } else if (err.type === 'entity.parse.failed') {
      error = new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    } else if (err.name === 'VersionError') {
      error = new ApiError(409, 'CONFLICT', 'This was changed by someone else. Reload and try again.');
    } else if (err.name === 'MulterError') {
      error =
        err.code === 'LIMIT_FILE_SIZE'
          ? new ApiError(413, 'FILE_TOO_LARGE', 'Image must be 5 MB or smaller')
          : new ApiError(422, 'UPLOAD_ERROR', err.code === 'LIMIT_UNEXPECTED_FILE' ? `Unexpected file field "${err.field}"` : err.message);
    } else if (err.type === 'entity.too.large') {
      error = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      error = new ApiError(err.statusCode || err.status || 500, 'INTERNAL_ERROR', 'Something went wrong');
    }
  }

  if (error.statusCode >= 500) {
    console.error(err);
  }

  const body = { success: false, error: { code: error.code, message: error.message } };
  if (error.details) body.error.details = error.details;
  if (process.env.NODE_ENV === 'DEVELOPMENT') body.error.stack = err.stack;

  res.status(error.statusCode).json(body);
};
