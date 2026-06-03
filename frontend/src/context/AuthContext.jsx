import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  browserSessionPersistence,
} from "firebase/auth";
import { ROLE_LABELS, ROLE_ROUTES } from "../auth/roleSystem.js";
import { api, warmupPortalRoute } from "../services/api.js";
import { AUTH_STATES, clearAuthStorage, getStoredToken, getStoredUser, publishAuthEvent, storeAuthSession, subscribeAuthEvents } from "../services/authSessionManager.js";
import { auth } from "../services/firebase.js";
import { teardownRealtimeSubscriptions } from "../services/realtimeManager.js";

const AuthContext = createContext(null);

function actionCodeSettings() {
  const url = import.meta.env.VITE_FIREBASE_ACTION_CONTINUE_URL || `${window.location.origin}/dealer/login`;
  return { url, handleCodeInApp: false };
}

function sessionFromResponse(response) {
  const sessionUser = response.data.user || {};
  return {
    uid: sessionUser.uid || sessionUser.email,
    email: sessionUser.email,
    role: sessionUser.role,
    roleLabel: ROLE_LABELS[sessionUser.role] || sessionUser.role,
    approved: sessionUser.approved === true,
    accountApproved: sessionUser.accountApproved === true,
    accountActive: sessionUser.accountActive !== false,
    dealershipId: sessionUser.dealershipId || null,
    dealershipName: sessionUser.dealershipName || null,
    dealerCity: sessionUser.dealerCity || null,
    bankId: sessionUser.bankId || null,
    bankName: sessionUser.bankName || null,
    bankIfsc: sessionUser.bankIfsc || null,
    bankBranchLocation: sessionUser.bankBranchLocation || null,
    branchId: sessionUser.branchId || null,
    firstLoginRequired: sessionUser.firstLoginRequired === true,
    passwordChangedAt: sessionUser.passwordChangedAt || null,
    passwordExpiresAt: sessionUser.passwordExpiresAt || null,
    passwordDaysRemaining: Number.isFinite(Number(sessionUser.passwordDaysRemaining)) ? Number(sessionUser.passwordDaysRemaining) : null,
    passwordExpired: sessionUser.passwordExpired === true,
    redirectTo: response.data.redirectTo || ROLE_ROUTES[sessionUser.role],
  };
}

function jwtRole(token) {
  try {
    const payload = token?.split(".")?.[1];
    if (!payload) return "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.role || "";
  } catch {
    return "";
  }
}

function logAuthDecision(label, { session, token, redirectTo } = {}) {
  console.info("[CLS auth]", label, {
    email: session?.email || "",
    backendRole: session?.role || "",
    jwtRole: jwtRole(token),
    redirectTo: redirectTo || session?.redirectTo || "",
    storedRole: getStoredUser()?.role || "",
  });
}

function registrationAccountError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getStoredToken()));
  const [authReady, setAuthReady] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(Boolean(getStoredToken() || getStoredUser()));
  const [authStatus, setAuthStatus] = useState(AUTH_STATES.LOADING);
  const portalWarmupRequested = useRef(false);

  const warmupSessionPortal = async (session) => {
    if (!session?.role || portalWarmupRequested.current) return;
    portalWarmupRequested.current = true;
    try {
      await warmupPortalRoute(session.role);
    } catch {
      // best-effort portal warmup
    }
  };

  const applySession = (session, token, options = {}) => {
    storeAuthSession(session, token, options);
    logAuthDecision("session-applied", { session, token });
    setUser(session);
    setIsAuthenticated(true);
    setAuthStatus(session.passwordExpired ? AUTH_STATES.PASSWORD_EXPIRED : AUTH_STATES.AUTHENTICATED);
  };

  const clearLocalSession = async ({ signOutFirebase = true, broadcast = true, reason = "local-clear" } = {}) => {
    portalWarmupRequested.current = false;
    teardownRealtimeSubscriptions();
    clearAuthStorage();
    setFirebaseUser(null);
    setIsAuthenticated(false);
    setUser(null);
    setAuthStatus(AUTH_STATES.UNAUTHORIZED);
    if (signOutFirebase) {
      try {
        await signOut(auth);
      } catch {
        // Local session is already cleared.
      }
    }
    if (broadcast) publishAuthEvent("logout", { reason });
  };

  const detachFirebaseCredentialSession = async () => {
    setFirebaseUser(null);
    try {
      if (auth.currentUser) await signOut(auth);
    } catch {
      // Backend JWT session remains the source of truth after login.
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseUser(currentUser || null);
      setAuthReady(true);
      const token = getStoredToken();
      if (!currentUser && !token) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthStatus(AUTH_STATES.UNAUTHORIZED);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authStatus === AUTH_STATES.AUTHENTICATED && user?.role) {
      warmupSessionPortal(user);
    }
  }, [authStatus, user?.role]);

  const loginWithEmailPassword = async ({ email, password, portal = "dealer", targetPortal = portal, rememberMe = true }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let credential;
    try {
      await setPersistence(auth, browserSessionPersistence);
      credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      const lookup = await api.post("/auth/account-lookup", { email: normalizedEmail, portal, targetPortal }).catch(() => null);
      if (lookup?.data) error.accountLookup = lookup.data;
      if (lookup?.data?.code === "ACCOUNT_LOCKED") throw error;
      const failure = await api.post("/auth/login-failure", { email: normalizedEmail, reason: error.code || "firebase-auth-failed" }).catch(() => null);
      if (failure?.data?.locked === true) error.accountLookup = failure.data;
      throw error;
    }
    await credential.user.reload();
    if (credential.user.emailVerified !== true) {
      const error = new Error("Please verify your email address before logging in.");
      error.code = "EMAIL_NOT_VERIFIED";
      setFirebaseUser(credential.user);
      throw error;
    }
    setFirebaseUser(credential.user);
    const idToken = await credential.user.getIdToken(true);
    let response;
    try {
      response = await api.post("/auth/login", { idToken, portal, targetPortal });
    } catch (error) {
      await clearLocalSession({ signOutFirebase: true, reason: "login-backend-rejected" });
      throw error;
    }
    const session = sessionFromResponse(response);
    logAuthDecision("login-response", { session, token: response.data.token, redirectTo: response.data.redirectTo });
    applySession(session, response.data.token);
    await detachFirebaseCredentialSession();
    await warmupSessionPortal(session);
    return session;
  };

  const sendPasswordReset = async (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    await api.post("/auth/password-reset/validate", { email: normalizedEmail });
    await sendPasswordResetEmail(auth, normalizedEmail, actionCodeSettings());
  };

  const resendVerificationEmail = async ({ email, password } = {}) => {
    let currentUser = auth.currentUser;
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
    await sendEmailVerification(currentUser, actionCodeSettings());
    return { sent: true };
  };

  const changeCurrentPassword = async ({ currentPassword, newPassword }) => {
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
      const response = await api.get("/auth/session");
      const session = sessionFromResponse(response);
      applySession(session, token);
      warmupSessionPortal(session);
      return session;
    } catch (error) {
      await clearLocalSession({ signOutFirebase: false, reason: "session-invalid" });
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
    validateSession({ showLoading: true });
    const interval = window.setInterval(() => {
      const current = getStoredUser();
      if (["finance-desk", "gm-sm", "bank-manager", "loan-executive"].includes(current?.role)) validateSession();
    }, 60000);
    const onFocus = () => validateSession();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [authReady]);

  useEffect(() => {
    const onSessionCleared = () => {
      teardownRealtimeSubscriptions();
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
    clearLocalSession({ signOutFirebase: false, broadcast: false, reason: event.payload?.reason || "cross-tab-logout" });
  }), []);

  const createRegistrationAccount = async ({ email, password }) => {
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
    if (!credential.user.emailVerified) await sendEmailVerification(credential.user, actionCodeSettings());
    return credential;
  };

  const startDealerRegistrationWithEmail = async ({ email, password }) => {
    const credential = await createRegistrationAccount({ email, password });
    setFirebaseUser(credential.user);
    const idToken = await credential.user.getIdToken();
    const response = await api.post("/dealer/register/email-start", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: credential.user.uid,
      email: response.data.email || credential.user.email,
      status: response.data.status,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/dealer-registration/form",
    };
    sessionStorage.setItem("cls_dealer_registration", JSON.stringify(registration));
    return registration;
  };

  const checkDealerRegistrationWithEmail = async ({ silent = false } = {}) => {
    const currentUser = auth.currentUser;
    if (!currentUser && silent) return { status: "unknown", message: "Sign in with your email and password to check the latest approval status." };
    if (!currentUser) return { status: "unknown", message: "Email/password session is required.", redirectTo: "/dealer-registration" };
    const idToken = await currentUser.getIdToken();
    const response = await api.post("/dealer/register/status", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: currentUser.uid,
      email: response.data.email || currentUser.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
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
    const response = await api.post("/bank/register", { ...profile, email });
    return response.data;
  };

  const startBankRegistrationWithEmail = async ({ email, password }) => {
    const credential = await createRegistrationAccount({ email, password });
    setFirebaseUser(credential.user);
    const idToken = await credential.user.getIdToken();
    const response = await api.post("/bank/register/email-start", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: credential.user.uid,
      email: response.data.email || credential.user.email,
      status: response.data.status,
      message: response.data.message,
      redirectTo: response.data.redirectTo || "/bank-registration/form",
    };
    sessionStorage.setItem("cls_bank_registration", JSON.stringify(registration));
    return registration;
  };

  const checkBankRegistrationWithEmail = async ({ silent = false } = {}) => {
    const currentUser = auth.currentUser;
    if (!currentUser && silent) return { status: "unknown", message: "Sign in with your email and password to check the latest approval status.", redirectTo: "/bank-registration" };
    if (!currentUser) return { status: "unknown", message: "Email/password session is required.", redirectTo: "/bank-registration" };
    const idToken = await currentUser.getIdToken();
    const response = await api.post("/bank/register/status", { idToken });
    const registration = {
      registrationId: response.data.registrationId || null,
      uid: currentUser.uid,
      email: response.data.email || currentUser.email,
      status: response.data.status,
      approvalStatus: response.data.approvalStatus || response.data.status,
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
