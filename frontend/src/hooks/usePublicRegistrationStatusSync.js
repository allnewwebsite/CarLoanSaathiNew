import { useEffect, useRef } from "react";

export function usePublicRegistrationStatusSync({
  enabled = true,
  checkStatus,
  intervalMs = 12000,
  maxIntervalMs = 60000,
} = {}) {
  const checkRef = useRef(checkStatus);
  const inFlightRef = useRef(false);
  checkRef.current = checkStatus;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof checkStatus !== "function") return undefined;
    let timer = 0;
    let attempts = 0;

    const nextDelay = () => Math.min(maxIntervalMs, intervalMs * Math.max(1, Math.ceil((attempts + 1) / 3)));

    const schedule = (delay = nextDelay()) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, delay);
    };

    const run = ({ resetBackoff = false } = {}) => {
      if (resetBackoff) attempts = 0;
      if (inFlightRef.current) return;
      if (document.hidden) {
        schedule(maxIntervalMs);
        return;
      }
      inFlightRef.current = true;
      Promise.resolve()
        .then(() => checkRef.current?.({ silent: true }))
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current = false;
          attempts += 1;
          schedule();
        });
    };

    const onVisibility = () => {
      if (!document.hidden) run({ resetBackoff: true });
    };

    schedule(1500);
    window.addEventListener("focus", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, maxIntervalMs]);
}
