import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { installFrontendLatencyListeners } from "./services/frontendLatency.js";
import { router } from "./routes/router.jsx";
import "./styles/index.css";

installFrontendLatencyListeners();

if (import.meta.env.VITE_SENTRY_DSN) {
  const scheduleIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 250));
  scheduleIdle(() => {
    import("./services/monitoring.js").then(({ initFrontendMonitoring }) => initFrontendMonitoring());
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
          <RouterProvider router={router} />
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
