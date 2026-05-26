function safeMeta(meta = {}) {
  return Object.fromEntries(Object.entries(meta).filter(([key]) => !/password|token|secret|key/i.test(key)));
}

export function captureError(error, meta = {}) {
  if (import.meta.env.PROD) {
    // Sentry can be wired here with VITE_SENTRY_DSN without touching app code.
    console.error("Captured production error", { message: error?.message, ...safeMeta(meta) });
    return;
  }
  console.error(error, safeMeta(meta));
}
