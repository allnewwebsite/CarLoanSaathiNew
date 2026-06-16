import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "../services/api.js";
import { OnboardingModal } from "../components/onboarding/OnboardingModal.jsx";

const OnboardingContext = createContext(null);
const SUPPORTED_ROLES = new Set(["finance-desk", "gm", "bank-manager", "loan-executive"]);

function canShowForUser(user) {
  return Boolean(
    user?.role
    && SUPPORTED_ROLES.has(user.role)
    && user.firstLoginRequired !== true
    && user.passwordExpired !== true
    && user.dashboardAccessAllowed !== false
    && user.accountActive !== false
    && user.accountApproved !== false
  );
}

export function OnboardingProvider({ children }) {
  const { user, isAuthenticated, validateSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [checkingKey, setCheckingKey] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = `${user?.uid || user?.email || ""}:${user?.role || ""}`;
    if (!isAuthenticated || !canShowForUser(user)) {
      setOpen(false);
      return undefined;
    }
    if (checkingKey === key) return undefined;
    setCheckingKey(key);

    const initialDecision = user.showOnboarding === true || user.onboardingCompleted !== true;
    if (!initialDecision) {
      setOpen(false);
      return undefined;
    }

    api.get("/onboarding/status", { params: { ts: Date.now() } })
      .then((response) => {
        if (cancelled) return;
        setOpen(response.data?.showOnboarding === true);
      })
      .catch(() => {
        if (!cancelled) setOpen(user.showOnboarding === true);
      });
    return () => {
      cancelled = true;
    };
  }, [checkingKey, isAuthenticated, user]);

  const complete = useCallback(async ({ skipped = false } = {}) => {
    if (pending) return;
    setPending(true);
    try {
      await api.post("/onboarding/complete", { skipped });
      setOpen(false);
      await validateSession({ silent: true, showLoading: false });
    } finally {
      setPending(false);
    }
  }, [pending, validateSession]);

  const replayProductTour = useCallback(() => {
    if (canShowForUser(user)) setOpen(true);
  }, [user]);

  const value = useMemo(() => ({
    replayProductTour,
    onboardingOpen: open,
  }), [open, replayProductTour]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      <OnboardingModal
        open={open}
        user={user}
        onComplete={() => complete({ skipped: false })}
        onSkip={() => complete({ skipped: true })}
      />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext) || { replayProductTour: () => {}, onboardingOpen: false };
}
