export function errorHandler(error, _req, res, _next) {
  console.error(error);
  if (error?.issues) {
    return res.status(400).json({
      message: "Validation failed",
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const status = error.status || 500;
  res.status(status).json({
    message: error.message || "Unexpected server error",
  });
}
