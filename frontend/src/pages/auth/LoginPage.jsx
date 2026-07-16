import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { ensureApiReady } from "../../services/api.js";
import { resolveAuthError } from "../../services/authErrorResolver.js";
import { LoginPageView } from "./LoginPageView.jsx";
import { clearRememberedLogin, portals, rememberedLogin, storeRememberedLogin, validEmail } from "./loginPage.helpers.js";
export function LoginPage({ portal = "dealer" }) {
  const config = portals[portal] || portals.dealer;
  const authPortal = config.authPortal || portal;
  const navigate = useNavigate();
  const { loginWithEmailPassword, sendPasswordReset, resendVerificationEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState(null);
  const [lockedUntil, setLockedUntil] = useState("");
  const [lockRemainingMs, setLockRemainingMs] = useState(0);

  useEffect(() => {
    const remembered = rememberedLogin(portal);
    if (remembered?.email) {
      setEmail(remembered.email);
      setRememberMe(true);
    }
  }, [portal]);

  useEffect(() => {
    if (!lockedUntil) {
      setLockRemainingMs(0);
      return undefined;
    }
    const expiresAt = new Date(lockedUntil).getTime();
    if (!Number.isFinite(expiresAt)) {
      setLockedUntil("");
      return undefined;
    }
    const updateRemaining = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setLockRemainingMs(remaining);
      if (remaining <= 0) setLockedUntil("");
    };
    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [lockedUntil]);

  const submit = async (event) => {
    event.preventDefault();
    if (loading || resetLoading || resendLoading) return;
    setLoading(true);
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    setShowResend(false);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!validEmail(normalizedEmail)) {
      setError("Enter a valid email address.");
      setLoading(false);
      return;
    }
    if (!password) {
      setError("Enter your password.");
      setLoading(false);
      return;
    }
    try {
      try {
        await ensureApiReady({ onStatus: setMessage });
      } catch (warmupError) {
        console.warn("Auth warmup failed; continuing with direct login request.", {
          code: warmupError?.code,
          message: warmupError?.message,
        });
      }
      setMessage("");
      const session = await loginWithEmailPassword({ email, password, portal: authPortal, targetPortal: portal, rememberMe });
      if (rememberMe) storeRememberedLogin(portal, normalizedEmail, session.role);
      else clearRememberedLogin(portal);
      navigate(session.redirectTo || "/", { replace: true });
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "login");
      setError(resolved.message);
      setErrorAction(resolved.actionTo ? { label: resolved.actionLabel, to: resolved.actionTo } : null);
      setShowResend(resolved.showResend);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    if (!validEmail(email)) {
      setError("Enter a valid email address before requesting a password reset.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordReset(email, portal);
      setMessage("Password reset link sent successfully. Please check your inbox.");
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "reset");
      setError(resolved.message);
      setErrorAction(resolved.actionTo ? { label: resolved.actionLabel, to: resolved.actionTo } : null);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setResetLoading(false);
    }
  };

  const resendVerification = async () => {
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    if (!validEmail(email) || !password) {
      setError("Enter your email and password before resending verification.");
      return;
    }
    setResendLoading(true);
    try {
      const result = await resendVerificationEmail({ email, password });
      setMessage(result.alreadyVerified ? "Email already verified. Please login again." : "Verification email sent successfully. Please check your inbox.");
      setShowResend(false);
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "verification");
      setError(resolved.message);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <LoginPageView
      config={config}
      email={email}
      error={error}
      errorAction={errorAction}
      loading={loading}
      lockRemainingMs={lockRemainingMs}
      lockedUntil={lockedUntil}
      message={message}
      navigate={navigate}
      password={password}
      rememberMe={rememberMe}
      resendLoading={resendLoading}
      resendVerification={resendVerification}
      resetLoading={resetLoading}
      resetPassword={resetPassword}
      setEmail={setEmail}
      setPassword={setPassword}
      setRememberMe={setRememberMe}
      setShowPassword={setShowPassword}
      showPassword={showPassword}
      showResend={showResend}
      submit={submit}
    />
  );
}
