import { useEffect, useMemo } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

function errorText(error) {
  if (!error) return "";
  return [
    error.message,
    error.statusText,
    error.data,
    String(error),
  ].filter(Boolean).join(" ");
}

function isChunkLoadError(error) {
  return /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk/i.test(errorText(error));
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const chunkLoadError = isChunkLoadError(error);
  const routeStatus = isRouteErrorResponse(error) ? error.status : 500;
  const storageKey = useMemo(() => `cls-route-reload:${window.location.pathname}`, []);

  useEffect(() => {
    if (!chunkLoadError) return;
    if (window.sessionStorage.getItem(storageKey) === "done") return;
    window.sessionStorage.setItem(storageKey, "done");
    window.location.reload();
  }, [chunkLoadError, storageKey]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">CarLoanSaathi</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-950">
          {chunkLoadError ? "Updating App" : routeStatus === 404 ? "Page Not Found" : "Something Went Wrong"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {chunkLoadError
            ? "A new version is available. Refresh the page once to continue."
            : routeStatus === 404
              ? "This page is no longer available."
              : "Please refresh the page and try again."}
        </p>
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          className="mt-5 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white"
        >
          Go Home
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ml-3 mt-5 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Refresh
        </button>
      </section>
    </main>
  );
}
