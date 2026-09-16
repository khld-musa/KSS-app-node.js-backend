const ApiError = require('../utils/ApiError');

// validate({ body: zodSchema, query: zodSchema, params: zodSchema })
// Parsed values land on req.validated.<key>; body is also written back to req.body.
// (Express 5 makes req.query read-only, hence req.validated.)
module.exports = (schemas) => (req, res, next) => {
  req.validated = req.validated || {};
  for (const key of ['body', 'query', 'params']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || key,
        message: i.message,
      }));
      return next(new ApiError(422, 'VALIDATION_ERROR', details[0].message, details));
    }
    req.validated[key] = result.data;
    if (key === 'body') req.body = result.data;
  }
  next();
};
