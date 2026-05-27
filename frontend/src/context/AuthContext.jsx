import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { ROLE_LABELS, ROLE_ROUTES } from "../auth/roleSystem.js";
import { api } from "../services/api.js";
import { auth } from "../services/firebase.js";

const AuthContext = createContext(null);

function actionCodeSettings() {
  const url = import.meta.env.VITE_FIREBASE_ACTION_CONTINUE_URL || `${window.location.origin}/dealer-login`;
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
    bankId: sessionUser.bankId || null,
    branchId: sessionUser.branchId || null,
    redirectTo: response.data.redirectTo || ROLE_ROUTES[sessionUser.role],
  };
}

function storedToken() {
  const sessionToken = sessionStorage.getItem("cls_token");
  if (sessionToken) return sessionToken;
  const legacyToken = localStorage.getItem("cls_token");
  if (legacyToken) {
    sessionStorage.setItem("cls_token", legacyToken);
    localStorage.removeItem("cls_token");
  }
  return legacyToken;
}

function clearStoredToken() {
  sessionStorage.removeItem("cls_token");
  localStorage.removeItem("cls_token");
}

function storeAuthSession(session, token) {
  localStorage.setItem("cls_user", JSON.stringify(session));
  if (token) {
    sessionStorage.setItem("cls_token", token);
    localStorage.removeItem("cls_token");
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("cls_user");
    return stored ? JSON.parse(stored) : null;
  });
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(storedToken()));
  const [authReady, setAuthReady] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(Boolean(storedToken()));

  const clearLocalSession = async () => {
    localStorage.removeItem("cls_user");
    clearStoredToken();
    setFirebaseUser(null);
    setIsAuthenticated(false);
    setUser(null);
    try {
      await signOut(auth);
    } catch {
      // Local session is already cleared.
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseUser(currentUser || null);
      setIsAuthenticated(Boolean(storedToken()));
      if (!storedToken()) setUser(null);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  const loginWithEmailPassword = async ({ email, password, portal = "dealer" }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let credential;
    try {
      credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      await api.post("/auth/login-failure", { email: normalizedEmail, reason: error.code || "firebase-auth-failed" }).catch(() => {});
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
    const response = await api.post("/auth/login", { idToken, portal });
    const session = sessionFromResponse(response);
    storeAuthSession(session, response.data.token);
    setUser(session);
    setIsAuthenticated(true);
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

  const validateSession = async ({ silent = true } = {}) => {
    const token = storedToken();
    if (!token) {
      setSessionChecking(false);
      return null;
    }
    setSessionChecking(true);
    try {
      const response = await api.get("/auth/session");
      const session = sessionFromResponse(response);
      storeAuthSession(session, token);
      setUser(session);
      setIsAuthenticated(true);
      return session;
    } catch (error) {
      await clearLocalSession();
      if (!silent) throw error;
      return null;
    } finally {
      setSessionChecking(false);
    }
  };

  useEffect(() => {
    if (!storedToken()) {
      setSessionChecking(false);
      return undefined;
    }
    validateSession();
    const interval = window.setInterval(() => {
      const current = JSON.parse(localStorage.getItem("cls_user") || "null");
      if (["finance-desk", "gm-sm", "bank-manager", "loan-executive"].includes(current?.role)) validateSession();
    }, 60000);
    const onFocus = () => validateSession();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const createRegistrationAccount = async ({ email, password }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error) {
      if (error.code === "auth/email-already-in-use") {
        credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      } else {
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
    await clearLocalSession();
  };

  const value = useMemo(() => ({
    user,
    firebaseUser,
    isAuthenticated,
    loading: !authReady || sessionChecking,
    authReady,
    loginWithEmailPassword,
    sendPasswordReset,
    resendVerificationEmail,
    logout,
    validateSession,
    registerBankPartner,
    startBankRegistrationWithEmail,
    checkBankRegistrationWithEmail,
    startDealerRegistrationWithEmail,
    checkDealerRegistrationWithEmail,
  }), [authReady, firebaseUser, isAuthenticated, sessionChecking, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
