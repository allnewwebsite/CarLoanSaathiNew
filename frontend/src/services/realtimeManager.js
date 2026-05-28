import { onSnapshot } from "firebase/firestore";

const subscriptions = new Map();
const diagnostics = {
  active: 0,
  opened: 0,
  closed: 0,
  errors: 0,
};

function notify(entry, payload) {
  entry.callbacks.forEach((callback) => {
    try {
      callback(payload);
    } catch {
      diagnostics.errors += 1;
    }
  });
}

function emitDiagnostics() {
  window.dispatchEvent(new CustomEvent("cls:realtime-diagnostics", { detail: { ...diagnostics } }));
}

function closeEntry(key, entry) {
  if (entry?.visibilityHandler) document.removeEventListener("visibilitychange", entry.visibilityHandler);
  if (entry?.unsubscribe) entry.unsubscribe();
  subscriptions.delete(key);
  diagnostics.active = subscriptions.size;
  diagnostics.closed += 1;
  emitDiagnostics();
}

export function subscribeRealtime({ key, queryFactory, onChange, onError, skipInitial = true }) {
  if (!key || typeof queryFactory !== "function" || typeof onChange !== "function") return () => {};

  let entry = subscriptions.get(key);
  if (entry) {
    entry.callbacks.add(onChange);
    if (onError) entry.errorCallbacks.add(onError);
    return () => {
      entry.callbacks.delete(onChange);
      entry.errorCallbacks.delete(onError);
      if (!entry.callbacks.size) closeEntry(key, entry);
    };
  }

  entry = {
    callbacks: new Set([onChange]),
    errorCallbacks: new Set(onError ? [onError] : []),
    hasInitialSnapshot: false,
    staleWhileHidden: false,
    visibilityHandler: null,
    unsubscribe: null,
  };

  const handleVisibility = () => {
    if (!document.hidden && entry.staleWhileHidden) {
      entry.staleWhileHidden = false;
      notify(entry, { reason: "visibility-resume" });
    }
  };

  entry.visibilityHandler = handleVisibility;
  document.addEventListener("visibilitychange", handleVisibility);

  entry.unsubscribe = onSnapshot(queryFactory(), (snapshot) => {
    if (skipInitial && !entry.hasInitialSnapshot) {
      entry.hasInitialSnapshot = true;
      return;
    }
    entry.hasInitialSnapshot = true;
    if (document.hidden) {
      entry.staleWhileHidden = true;
      return;
    }
    notify(entry, { reason: "snapshot", changes: snapshot.docChanges().length });
  }, (error) => {
    diagnostics.errors += 1;
    entry.errorCallbacks.forEach((callback) => callback(error));
    notify(entry, { reason: "listener-error", error });
    emitDiagnostics();
  });

  subscriptions.set(key, entry);
  diagnostics.opened += 1;
  diagnostics.active = subscriptions.size;
  emitDiagnostics();

  return () => {
    const activeEntry = subscriptions.get(key);
    if (!activeEntry) return;
    activeEntry.callbacks.delete(onChange);
    activeEntry.errorCallbacks.delete(onError);
    if (!activeEntry.callbacks.size) closeEntry(key, activeEntry);
  };
}

export function teardownRealtimeSubscriptions() {
  [...subscriptions.entries()].forEach(([key, entry]) => closeEntry(key, entry));
}

export function realtimeDiagnostics() {
  return { ...diagnostics, active: subscriptions.size };
}
