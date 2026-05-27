import * as Sentry from "@sentry/react";

function safeMeta(meta = {}) {
  return Object.fromEntries(Object.entries(meta).filter(([key]) => !/password|token|secret|key|authorization/i.test(key)));
}

export function initFrontendMonitoring() {
  if (!import.meta.env.VITE_SENTRY_DSN) return false;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_APP_ENV || import.meta.env.MODE,
    release: import.meta.env.VITE_APP_RELEASE || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || "local",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    replaysSessionSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAY_SAMPLE_RATE || 0),
    replaysOnErrorSampleRate: Number(import.meta.env.VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE || 0.1),
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
  return true;
}

export function captureError(error, meta = {}) {
  const clean = safeMeta(meta);
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(clean)) scope.setExtra(key, value);
      if (clean.requestId) scope.setTag("requestId", clean.requestId);
      if (clean.portal) scope.setTag("portal", clean.portal);
      Sentry.captureException(error);
    });
    return;
  }
  if (import.meta.env.DEV) console.error(error, clean);
}
