import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePublicRegistrationStatusSync } from "../hooks/usePublicRegistrationStatusSync.js";
import { selectedOnboardingPlan } from "../services/onboardingPlan.js";
import { useAuth } from "../context/AuthContext.jsx";
import { DealerRegistrationLandingView } from "./dealerRegistration/DealerRegistrationLandingView.jsx";
import {
  DealerApprovalCheckingView,
  DealerApprovedView,
  DealerPendingStatusView,
} from "./dealerRegistration/DealerRegistrationStatusViews.jsx";

export function DealerRegistrationPage({ audience = "dealer" }) {
  const isFinanceAudience = audience === "finance";
  const onboardingEyebrow = isFinanceAudience ? "Finance Head Registration" : "Dealer partner onboarding";
  const onboardingTitle = isFinanceAudience ? "Finance Head Registration" : "Partner with CarLoanSaathi";
  const onboardingSubtitle = isFinanceAudience
    ? "For dealership finance managers responsible for customer loan processing and bank coordination."
    : "India's dealership-to-bank automotive finance operating platform.";
  const onboardingBody = isFinanceAudience
    ? "Create the approved dealership account used by finance heads to submit customer loan cases, coordinate with partner banks, and track approvals from one secure dashboard."
    : "Manage finance operations, route leads to partner banks, track approvals, monitor disbursement, and streamline dealership finance workflows from one centralized platform.";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const { startDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  const beginRegistration = async () => {
    if (!authEmail.trim() || !authPassword) {
      setError("Enter email address and password to create your dealership account.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const registration = await startDealerRegistrationWithEmail({
        email: authEmail,
        password: authPassword,
        selectedPlan: selectedOnboardingPlan(),
      });
      navigate(registration.redirectTo || "/dealer-registration/form");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create email/password account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DealerRegistrationLandingView
      authEmail={authEmail}
      authPassword={authPassword}
      error={error}
      loading={loading}
      onboardingBody={onboardingBody}
      onboardingEyebrow={onboardingEyebrow}
      onboardingSubtitle={onboardingSubtitle}
      onboardingTitle={onboardingTitle}
      onBeginRegistration={beginRegistration}
      onEmailChange={setAuthEmail}
      onPasswordChange={setAuthPassword}
      onTogglePassword={() => setShowAuthPassword((current) => !current)}
      showAuthPassword={showAuthPassword}
    />
  );
}

export function DealerRegistrationApprovedPage() {
  const [allowed, setAllowed] = useState(null);
  const { checkDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const guard = async () => {
      const registration = await checkDealerRegistrationWithEmail({ silent: true });
      if (registration.status === "approved" || registration.approvalStatus === "approved") {
        setAllowed(true);
      } else {
        navigate(registration.redirectTo || "/dealer-registration", { replace: true });
      }
    };
    guard();
  }, [checkDealerRegistrationWithEmail, navigate]);

  if (allowed !== true) {
    return <DealerApprovalCheckingView />;
  }

  return <DealerApprovedView />;
}

export function DealerRegistrationPendingPage({ mode = "pending" }) {
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const [status, setStatus] = useState(mode === "verify-email" ? "email-pending" : mode);
  const { checkDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  const statusRoute = {
    "email-pending": "/dealer-registration/verify-email",
    pending: "/dealer-registration/pending",
    submitted: "/dealer-registration/pending",
    rejected: "/dealer-registration/rejected",
    suspended: "/dealer-registration/suspended",
  };

  const applyRegistrationStatus = (registration) => {
    const nextStatus = registration.status || registration.approvalStatus || "pending";
    if (registration.status === "approved" || registration.approvalStatus === "approved") {
      setApproved(true);
      return;
    }
    if (nextStatus === "not-submitted" || registration.accountState === "EMAIL_VERIFIED") {
      navigate(registration.redirectTo || "/dealer-registration/form", { replace: true });
      return;
    }
    const allowed = ["email-pending", "pending", "submitted", "rejected", "suspended"].includes(nextStatus);
    if (!allowed) {
      navigate(registration.redirectTo || "/dealer-registration", { replace: true });
      return;
    }
    setStatus(nextStatus);
    setMessage(registration.message || "");
    const expectedRoute = statusRoute[nextStatus] || "/dealer-registration/pending";
    if (registration.redirectTo && registration.redirectTo !== expectedRoute) {
      navigate(registration.redirectTo, { replace: true });
    } else if (window.location.pathname !== expectedRoute) {
      navigate(expectedRoute, { replace: true });
    }
  };

  const checkStatus = async ({ silent = false } = {}) => {
    if (!silent) setChecking(true);
    setMessage("");
    try {
      const registration = await checkDealerRegistrationWithEmail({ silent });
      applyRegistrationStatus(registration);
    } catch (err) {
      if (!silent) setMessage(err.response?.data?.message || err.message || "Unable to check approval status.");
    } finally {
      if (!silent) setChecking(false);
    }
  };

  useEffect(() => {
    const checkSilently = async () => {
      setChecking(true);
      try {
        const registration = await checkDealerRegistrationWithEmail({ silent: true });
        applyRegistrationStatus(registration);
      } finally {
        setChecking(false);
      }
    };
    checkSilently();
  }, []);
  usePublicRegistrationStatusSync({
    enabled: ["email-pending", "pending", "submitted"].includes(status) && !approved,
    checkStatus,
  });

  if (approved) {
    return <DealerApprovedView showSteps onLogin={() => navigate("/dealer/login")} />;
  }

  if (checking) {
    return <DealerApprovalCheckingView />;
  }

  const statusCopy = {
    "email-pending": {
      title: "Verify Your Email",
      body: "We sent a verification link to your email address. Verify it before completing dealership registration.",
      badge: "Email Verification Pending",
      steps: [["Done", "Email account created"], ["Pending", "Email verification"], ["Next", "Complete dealership registration"]],
    },
    rejected: {
      title: "Registration Rejected",
      body: message || "Your dealership registration was rejected by CarLoanSaathi.",
      badge: "Rejected",
      steps: [["Done", "Email verified"], ["Done", "Registration reviewed"], ["Rejected", "Approval not granted"]],
    },
    suspended: {
      title: "Account Suspended",
      body: message || "Your dealership account is suspended. Contact CarLoanSaathi support for next steps.",
      badge: "Suspended",
      steps: [["Done", "Email verified"], ["Done", "Account reviewed"], ["Suspended", "Dashboard access blocked"]],
    },
    pending: {
      title: "Approval Pending",
      body: "Your dealership registration has been submitted successfully and is under verification by CarLoanSaathi.",
      badge: "Pending Super Admin Verification",
      steps: [["Done", "Email verified"], ["Done", "Registration submitted"], ["Pending", "Waiting for admin verification"]],
    },
    submitted: {
      title: "Approval Pending",
      body: "Your dealership registration has been submitted successfully and is under verification by CarLoanSaathi.",
      badge: "Pending Super Admin Verification",
      steps: [["Done", "Email verified"], ["Done", "Registration submitted"], ["Pending", "Waiting for admin verification"]],
    },
  };
  const copy = statusCopy[status] || statusCopy.pending;

  return <DealerPendingStatusView copy={copy} message={message} onCheckStatus={checkStatus} status={status} />;
}

export { DealerRegistrationFormPage } from './dealerRegistration/DealerRegistrationFormPage.jsx';
