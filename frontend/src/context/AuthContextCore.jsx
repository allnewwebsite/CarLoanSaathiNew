import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AUTH_STATES, clearAuthStorage, getCurrentPortalScope, getStoredToken, getStoredUser, publishAuthEvent, storeAuthSession, subscribeAuthEvents } from "../services/authSessionManager.js";
import { selectedOnboardingPlan } from "../services/onboardingPlan.js";
import {
  LOGIN_PORTAL_ROLES,
  ROLE_LOGIN_PORTALS,
  SESSION_VALIDATE_FRESHNESS_MS,
  SESSION_VALIDATE_KEY,
  actionCodeSettings,
  registrationAccountError,
  restoredFirebaseUser,
  sessionFromResponse,
  shouldClearSessionForError,
  wrongPortalError,
} from "./AuthContext.helpers.js";

const AuthContext = createContext(null);
let firebaseAuthLoaded = false;
let realtimeClientLoaded = false;
let apiClientPromise = null;

async function loadApiClient() {
  if (!apiClientPromise) apiClientPromise = import("../services/api.js").then((module) => module.api);
  return apiClientPromise;
}

async function loadFirebaseAuth() {
  const [firebaseAuth, authModule] = await Promise.all([
    import("firebase/auth"),
    import("../services/firebaseAuth.js"),
  ]);
  firebaseAuthLoaded = true;
  return { ...firebaseAuth, auth: authModule.auth };
}

async function loadRealtimeClient() {
  const realtimeClient = await import("../services/realtimeClient.js");
  realtimeClientLoaded = true;
  return realtimeClient;
}

function stopRealtimeIfLoaded(identity) {
  if (!realtimeClientLoaded) return;
  loadRealtimeClient().then(({ stopRealtimeClient }) => stopRealtimeClient(identity));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getStoredToken() || getStoredUser()));
  const [authReady] = useState(true);
  const [sessionChecking, setSessionChecking] = useState(false);
  const [authStatus, setAuthStatus] = useState(AUTH_STATES.LOADING);
  const applySession = (session, token, options = {}) => {
    storeAuthSession(session, token, options);
    setUser(session);
    setIsAuthenticated(true);
    setAuthStatus(session.passwordExpired ? AUTH_STATES.PASSWORD_EXPIRED : AUTH_STATES.AUTHENTICATED);
  };

  const clearLocalSession = async ({ signOutFirebase = true, broadcast = true, reason = "local-clear" } = {}) => {
    stopRealtimeIfLoaded();
    clearAuthStorage();
    setFirebaseUser(null);
    setIsAuthenticated(false);
    setUser(null);
    setAuthStatus(AUTH_STATES.UNAUTHORIZED);
    if (signOutFirebase) {
      try {
        const { auth, signOut } = await loadFirebaseAuth();
        await signOut(auth);
      } catch {
        // Local session is already cleared.
      }
    }
    if (broadcast) publishAuthEvent("logout", { reason });
  };

  const detachFirebaseCredentialSession = async () => {
    setFirebaseUser(null);
    if (!firebaseAuthLoaded) return;
    try {
      const { auth, signOut } = await loadFirebaseAuth();
      if (auth.currentUser) await signOut(auth);
    } catch {
      // Backend JWT session remains the source of truth after login.
    }
  };

  useEffect(() => {
    const realtimeIdentity = [user?.sessionId, user?.role, user?.uid || user?.email, user?.organizationId || user?.dealershipId || user?.bankId || ""]
      .filter(Boolean)
      .join(":");
    let cancelled = false;
    if (isAuthenticated && user?.role) {
      loadRealtimeClient().then(({ startRealtimeClient }) => {
        if (!cancelled) startRealtimeClient(realtimeIdentity);
      });
    } else {
      stopRealtimeIfLoaded();
    }
    return () => {
      cancelled = true;
      stopRealtimeIfLoaded(realtimeIdentity);
    };
  }, [isAuthenticated, user?.sessionId, user?.role, user?.uid, user?.email, user?.organizationId, user?.dealershipId, user?.bankId]);

  const loginWithEmailPassword = async ({ email, password, portal = "dealer", targetPortal = portal, rememberMe = true }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const loginPayload = { email: normalizedEmail, password, portal, targetPortal };
    const api = await loadApiClient();

    let response;
    try {
      response = await api.post("/auth/login", loginPayload, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error?.response?.status === 401 || error?.response?.status === 404 || error?.response?.status === 403) {
        const lookup = await api.post("/auth/account-lookup", { email: normalizedEmail, portal, targetPortal }).catch(() => null);
        if (lookup?.data) error.accountLookup = lookup.data;
      }
      throw error;
    }
    const session = sessionFromResponse(response);
    const allowedRoles = LOGIN_PORTAL_ROLES[String(targetPortal || portal || "").trim().toLowerCase()] || [];
    const expectedLoginPortal = ROLE_LOGIN_PORTALS[session.role] || "";
    if (!allowedRoles.includes(session.role) || (session.loginPortal && session.loginPortal !== expectedLoginPortal)) {
      throw wrongPortalError(session.role);
    }
    applySession(session, response.data.token);
    detachFirebaseCredentialSession();
    return session;
  };

  const sendPasswordReset = async (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const api = await loadApiClient();
    await api.post("/auth/password-reset/validate", { email: normalizedEmail });
    const { auth, sendPasswordResetEmail } = await loadFirebaseAuth();
    await sendPasswordResetEmail(auth, normalizedEmail, actionCodeSettings());
  };

  const resendVerificationEmail = async ({ email, password, portal = "dealer" } = {}) => {
    const { auth, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword } = await loadFirebaseAuth();
    let currentUser = await restoredFirebaseUser(auth, onAuthStateChanged);
    if (!currentUser && email && password) {
      const credential = await signInWithEmailAndPassword(auth, String(email || "").trim().toLowerCase(), password);
      currentUser = credential.user;
    }
    if (!currentUser) {
      const error = new Error("Sign in with your email and password before resending verification.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    await currentUser.reload();
    if (currentUser.emailVerified) return { alreadyVerified: true };
    await sendEmailVerification(currentUser, actionCodeSettings(portal));
    return { sent: true };
  };

  const changeCurrentPassword = async ({ currentPassword, newPassword }) => {
    const {
      auth,
      browserSessionPersistence,
      EmailAuthProvider,
      reauthenticateWithCredential,
      setPersistence,
      signInWithEmailAndPassword,
      updatePassword,
    } = await loadFirebaseAuth();
    const expectedEmail = String(user?.email || getStoredUser()?.email || "").trim().toLowerCase();
    if (!expectedEmail) {
      const error = new Error("Login again before changing your password.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    let currentUser = auth.currentUser;
    const currentEmail = String(currentUser?.email || "").trim().toLowerCase();
    if (!currentUser?.email || currentEmail !== expectedEmail) {
      await setPersistence(auth, browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, expectedEmail, currentPassword);
      currentUser = credential.user;
    } else {
      const credential = EmailAuthProvider.credential(expectedEmail, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
    }
    await updatePassword(currentUser, newPassword);
    await currentUser.getIdToken(true);
    const api = await loadApiClient();
    const response = await api.post("/auth/password/change-complete");
    if (response.data?.token && response.data?.user) {
      const session = sessionFromResponse(response);
      applySession(session, response.data.token);
      await detachFirebaseCredentialSession();
      return session;
    }
    const refreshed = await validateSession({ silent: false, showLoading: false });
    return refreshed || response.data;
  };

  const validateSession = async ({ silent = true, showLoading = false } = {}) => {
    const token = getStoredToken();
    if (!token) {
      setSessionChecking(false);
      setAuthStatus(AUTH_STATES.UNAUTHORIZED);
      return null;
    }
    if (showLoading) setSessionChecking(true);
    try {
      const api = await loadApiClient();
      const response = await api.get("/auth/session");
      const session = sessionFromResponse(response);
      applySession(session, token);
      try {
        sessionStorage.setItem(SESSION_VALIDATE_KEY, String(Date.now()));
      } catch {
        // Validation timestamp is only a performance hint.
      }
      return session;
    } catch (error) {
      if (shouldClearSessionForError(error)) {
        await clearLocalSession({ signOutFirebase: false, reason: error?.response?.data?.code || "session-invalid" });
      } else {
        setAuthStatus(getStoredUser() ? AUTH_STATES.AUTHENTICATED : AUTH_STATES.UNAUTHORIZED);
      }
      if (!silent) throw error;
      return null;
    } finally {
      if (showLoading) setSessionChecking(false);
    }
  };

  useEffect(() => {
    if (!authReady) return undefined;
    if (!getStoredToken()) {
      setSessionChecking(false);
      return undefined;
    }
    let recentlyValidated = false;
    try {
      recentlyValidated = Date.now() - Number(sessionStorage.getItem(SESSION_VALIDATE_KEY) || 0) < SESSION_VALIDATE_FRESHNESS_MS;
    } catch {
      recentlyValidated = false;
    }
    if (!recentlyValidated) validateSession({ showLoading: false });
    const validateWhenOnline = () => validateSession();
    window.addEventListener("online", validateWhenOnline);
    return () => window.removeEventListener("online", validateWhenOnline);
  }, [authReady]);

  useEffect(() => {
    const onSessionCleared = () => {
      setFirebaseUser(null);
      setIsAuthenticated(false);
      setUser(null);
      setAuthStatus(AUTH_STATES.UNAUTHORIZED);
      setSessionChecking(false);
    };
    window.addEventListener("cls:auth-session-cleared", onSessionCleared);
    return () => window.removeEventListener("cls:auth-session-cleared", onSessionCleared);
  }, []);

  useEffect(() => {
    const onTokenRefreshed = (event) => {
      if (!event.detail?.user || !event.detail?.token) return;
      const session = sessionFromResponse({ data: event.detail });
      applySession(session, event.detail.token);
    };
    window.addEventListener("cls:auth-token-refreshed", onTokenRefreshed);
    return () => window.removeEventListener("cls:auth-token-refreshed", onTokenRefreshed);
  }, []);

  useEffect(() => subscribeAuthEvents((event) => {
    if (event?.type !== "logout") return;
    const eventScope = event.payload?.scope;
    const currentScope = getCurrentPortalScope();
    if (eventScope && currentScope && eventScope !== currentScope) return;
    clearLocalSession({ signOutFirebase: false, broadcast: false, reason: event.payload?.reason || "cross-tab-logout" });
  }), []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let refreshTimer = 0;
    const onRealtimeMutation = (event) => {
      const detail = event?.detail || {};
      if (!detail.realtime || !["subscription", "dealer", "bank", "staff"].includes(detail.kind)) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        validateSession({ silent: true, showLoading: false });
      }, 400);
    };
    window.addEventListener("cls:data-mutated", onRealtimeMutation);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener("cls:data-mutated", onRealtimeMutation);
    };
  }, [isAuthenticated]);

  const createRegistrationAccount = async ({ email, password, portal = "dealer" }) => {
    const { auth, createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword } = await loadFirebaseAuth();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      if (error.code === "auth/email-already-in-use") {
        try {
          credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        } catch {
          throw registrationAccountError(
            "This email already has an account. Please enter the existing password or reset the password before continuing.",
            "ACCOUNT_ALREADY_EXISTS"
          );
        }
      } else {
        if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
          throw registrationAccountError(
            "This email already has an account. Please enter the existing password or reset the password before continuing.",
            "ACCOUNT_ALREADY_EXISTS"
          );
        }
        if (error.code === "auth/weak-password") {
          throw registrationAccountError("Password is too weak. Please use at least 6 characters.", "WEAK_PASSWORD");
        }
        if (error.code === "auth/invalid-email") {
          throw registrationAccountError("Enter a valid email address.", "INVALID_EMAIL");
        }
        throw error;
      }
    }
    await credential.user.reload();
    if (!credential.user.emailVerified) await sendEmailVerification(credential.user, actionCodeSettings(portal));
    return credential;
  };

  const startDealerRegistrationWithEmail = async ({ email, password, selectedPlan = selectedOnboardingPlan() }) => {
    const credential = await createRegistrationAccount({ email, password, portal: "dealer" });
    setFirebaseUser(credential.user);
    await credential.user.reload();
    const idToken = await credential.user.getIdToken(true);
    const api = await loadApiClient();
    const response = await api.post("/dealer/register/email-start", { idToken, selectedPlan });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: credential.user.uid,
      email: response.data.email || credential.user.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
      accountState: response.data.accountState || null,
      emailVerified: response.data.emailVerified === true,
      registrationSubmitted: response.data.registrationSubmitted,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/dealer-registration/form",
      selectedPlan: response.data.selectedPlan || selectedPlan,
    };
    sessionStorage.setItem("cls_dealer_registration", JSON.stringify(registration));
    return registration;
  };

  const checkDealerRegistrationWithEmail = async ({ silent = false } = {}) => {
    const { auth, onAuthStateChanged } = await loadFirebaseAuth();
    const currentUser = await restoredFirebaseUser(auth, onAuthStateChanged);
    if (!currentUser && silent) return { status: "unknown", message: "Sign in with your email and password to check the latest approval status." };
    if (!currentUser) return { status: "unknown", message: "Email/password session is required.", redirectTo: "/dealer-registration" };
    await currentUser.reload();
    const idToken = await currentUser.getIdToken(true);
    const api = await loadApiClient();
    const response = await api.post("/dealer/register/status", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: currentUser.uid,
      email: response.data.email || currentUser.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
      accountState: response.data.accountState || null,
      emailVerified: response.data.emailVerified === true,
      registrationSubmitted: response.data.registrationSubmitted,
      accountApproved: response.data.accountApproved === true,
      accountActive: response.data.accountActive === true,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/dealer-registration/form",
    };
    sessionStorage.setItem("cls_dealer_registration", JSON.stringify(registration));
    return registration;
  };

  const registerBankPartner = async ({ email, profile }) => {
    const api = await loadApiClient();
    const response = await api.post("/bank/register", { ...profile, email });
    return response.data;
  };

  const startBankRegistrationWithEmail = async ({ email, password }) => {
    const credential = await createRegistrationAccount({ email, password, portal: "bank" });
    setFirebaseUser(credential.user);
    await credential.user.reload();
    const idToken = await credential.user.getIdToken(true);
    const api = await loadApiClient();
    const response = await api.post("/bank/register/email-start", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: credential.user.uid,
      email: response.data.email || credential.user.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
      accountState: response.data.accountState || null,
      emailVerified: response.data.emailVerified === true,
      registrationSubmitted: response.data.registrationSubmitted,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/bank-registration/form",
    };
    sessionStorage.setItem("cls_bank_registration", JSON.stringify(registration));
    return registration;
  };

  const checkBankRegistrationWithEmail = async ({ silent = false } = {}) => {
    const { auth, onAuthStateChanged } = await loadFirebaseAuth();
    const currentUser = await restoredFirebaseUser(auth, onAuthStateChanged);
    if (!currentUser && silent) return { status: "unknown", message: "Sign in with your email and password to check the latest approval status.", redirectTo: "/bank-registration" };
    if (!currentUser) return { status: "unknown", message: "Email/password session is required.", redirectTo: "/bank-registration" };
    await currentUser.reload();
    const idToken = await currentUser.getIdToken(true);
    const api = await loadApiClient();
    const response = await api.post("/bank/register/status", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: currentUser.uid,
      email: response.data.email || currentUser.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
      accountState: response.data.accountState || null,
      emailVerified: response.data.emailVerified === true,
      registrationSubmitted: response.data.registrationSubmitted,
      accountApproved: response.data.accountApproved === true,
      accountActive: response.data.accountActive === true,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/bank-registration",
    };
    sessionStorage.setItem("cls_bank_registration", JSON.stringify(registration));
    return registration;
  };

  const logout = async () => {
    try {
      const api = await loadApiClient();
      await api.post("/auth/logout");
    } catch {
      // Local cleanup must still happen even if the log request fails.
    }
    await clearLocalSession({ signOutFirebase: false, reason: "manual-logout" });
  };

  const value = useMemo(() => ({
    user,
    firebaseUser,
    isAuthenticated,
    loading: !authReady || sessionChecking,
    authStatus,
    authReady,
    loginWithEmailPassword,
    sendPasswordReset,
    changeCurrentPassword,
    resendVerificationEmail,
    logout,
    validateSession,
    registerBankPartner,
    startBankRegistrationWithEmail,
    checkBankRegistrationWithEmail,
    startDealerRegistrationWithEmail,
    checkDealerRegistrationWithEmail,
  }), [authReady, authStatus, firebaseUser, isAuthenticated, sessionChecking, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
