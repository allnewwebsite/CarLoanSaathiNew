const PORTAL_LOGIN_PATHS = {
  dealer: "/dealer-login",
  finance: "/finance/login",
  bank: "/bank-login",
  executive: "/executive/login",
  admin: "/super-admin",
};

const CREATE_ACCOUNT_PATHS = {
  dealer: "/dealer-registration",
  finance: "/finance/register",
  bank: "/bank-registration",
};

function responseData(error) {
  return error?.accountLookup || error?.response?.data || {};
}

function base(message, overrides = {}) {
  return {
    message,
    actionLabel: "",
    actionTo: "",
    showCreateAccount: false,
    showForgotPassword: true,
    showResend: false,
    ...overrides,
  };
}

export function resolveAuthError(error, portal = "dealer", action = "login") {
  const data = responseData(error);
  const code = data.code || error?.response?.data?.code || error?.code || "";
  const firebaseCode = error?.code || "";
  const message = data.message || error?.response?.data?.message || error?.message || "";

  if (code === "WRONG_PORTAL") {
    return base(data.message || "This email belongs to a different portal.", {
      actionLabel: data.actionLabel || "Go to Correct Login",
      actionTo: data.redirectTo || PORTAL_LOGIN_PATHS[data.correctPortal] || "/",
      showCreateAccount: false,
    });
  }

  if (code === "EMAIL_NOT_VERIFIED" || /verify your email/i.test(message)) {
    return base(action === "reset" ? "Verify your email before resetting password." : "Please verify your email address before logging in.", {
      showResend: action !== "reset",
    });
  }

  if (["ACCOUNT_DISABLED", "ACCOUNT_NOT_ACTIVE"].includes(code)) {
    return base(data.message || "Your account has been temporarily disabled. Contact support.", { showForgotPassword: false });
  }

  if (code === "ACCOUNT_LOCKED" || error?.response?.status === 423) {
    return base(data.message || "Account locked after repeated failed attempts. Try again later.", { showForgotPassword: false });
  }

  if (code === "APPROVAL_PENDING" || code === "ACCOUNT_NOT_APPROVED" || /awaiting approval|pending approval|still pending/i.test(message)) {
    return base(data.message || "Your account exists but is awaiting approval from Super Admin.", {
      actionLabel: data.actionLabel || "",
      actionTo: data.redirectTo || "",
      showForgotPassword: false,
    });
  }

  if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials" || (code === "ACCOUNT_FOUND" && /auth\/(wrong-password|invalid-credential|invalid-login-credentials)/.test(firebaseCode))) {
    return base("Incorrect password. Please try again or use Forgot Password.");
  }

  if (code === "auth/user-not-found" || code === "NO_ACCOUNT" || error?.response?.status === 404) {
    return base("No account found for this email.", {
      actionLabel: CREATE_ACCOUNT_PATHS[portal] ? "Create Account" : "",
      actionTo: CREATE_ACCOUNT_PATHS[portal] || "",
      showCreateAccount: Boolean(CREATE_ACCOUNT_PATHS[portal]),
      showForgotPassword: false,
    });
  }

  if (code === "auth/weak-password") return base("Password is too weak.");
  if (code === "auth/too-many-requests") return base("Too many attempts. Try again later.", { showForgotPassword: false });

  if (code === "auth/requests-from-referer-are-blocked" || /referer.*blocked/i.test(message)) {
    return base("This website is blocked by Firebase API key restrictions. Add this domain in Google Cloud API key restrictions.", { showForgotPassword: false });
  }

  if (error?.code === "ERR_NETWORK" || error?.code === "ECONNABORTED") {
    if (action === "reset") return base("We could not reach the secure password reset service. Check your connection and try again.", { showForgotPassword: false });
    if (action === "verification") return base("We could not reach the verification service. Check your connection and try again.", { showForgotPassword: false });
    return base("We could not reach the secure login service. Check your connection and try again.", { showForgotPassword: false });
  }

  return base(message || "Login could not be completed. Please verify your email and password.");
}
