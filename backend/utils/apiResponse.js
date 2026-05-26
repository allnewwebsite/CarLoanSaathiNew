export function successResponse(res, { message = "OK", data = null, meta = {}, status = 200, pagination = null } = {}) {
  const payload = {
    success: true,
    message,
    data,
    meta: {
      requestId: res.locals.requestId || null,
      durationMs: Date.now() - (res.locals.startedAt || Date.now()),
      ...meta,
    },
  };
  if (pagination) payload.pagination = pagination;
  return res.status(status).json(payload);
}

export function errorResponse(res, {
  status = 500,
  errorCode = "INTERNAL_ERROR",
  message = "Unexpected server error",
  details = null,
} = {}) {
  return res.status(status).json({
    success: false,
    errorCode,
    message,
    details,
    requestId: res.locals.requestId || null,
  });
}

export function attachApiResponse(req, res, next) {
  res.success = (options = {}) => successResponse(res, options);
  res.fail = (options = {}) => errorResponse(res, options);
  next();
}
