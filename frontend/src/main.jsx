import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { initFrontendMonitoring } from "./services/monitoring.js";
import { preloadDashboardRoutes, router } from "./routes/router.jsx";
import "./styles/index.css";

initFrontendMonitoring();

const schedulePreload = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 250));
schedulePreload(() => preloadDashboardRoutes());

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
