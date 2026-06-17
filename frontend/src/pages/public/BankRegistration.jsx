import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { bankLoanCapacityRanges, bankStates, locationsForState } from "../../data/bankLocationMaster.js";
import { usePublicRegistrationStatusSync } from "../../hooks/usePublicRegistrationStatusSync.js";
import { initialForm } from "./bankRegistration.constants.js";
import { BankExecutiveLandingView, BankRegistrationLandingView } from "./BankRegistrationLandingView.jsx";
import {
  BankDocumentUploadsSection,
  BankEmailVerificationSection,
  BankIdentitySection,
  BankManagerDetailsSection,
  BankManualVerificationSection,
  BankOperationsSection,
} from "./BankRegistrationFormSections.jsx";
import {
  BankRegistrationApprovedView,
  BankRegistrationCheckingView,
  BankRegistrationStatusView,
} from "./BankRegistrationStatusView.jsx";

function fieldError(form) {
  if (!form.bankName) return "Select a bank.";
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) return "Enter a valid IFSC code.";
  if (!form.state) return "Select a state.";
  if (!form.branchLocation) return "Select a branch service area.";
  if (!/^[6-9][0-9]{9}$/.test(form.managerMobile)) return "Enter a valid 10 digit manager mobile number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Enter a valid official bank email.";
  if (!bankLoanCapacityRanges.includes(form.monthlyLoanCapacity)) return "Select monthly loan capacity.";
  return "";
}

export function BankRegistration({ mode = "landing", audience = "bank" }) {
  const { registerBankPartner, startBankRegistrationWithEmail, checkBankRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("cls_bank_registration") || "{}");
    } catch {
      return {};
    }
  });
  const [form, setForm] = useState(() => ({ ...initialForm, email: session.email || "" }));
  const [authEmail, setAuthEmail] = useState(session.email || "");
  const [authPassword, setAuthPassword] = useState("");
  const [uploads, setUploads] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(mode === "pending" || mode === "approved");
  const [approved, setApproved] = useState(mode === "approved");
  const [status, setStatus] = useState(mode === "verify-email" ? "email-pending" : mode);
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingDetails, setPendingDetails] = useState(null);
  const bankUid = session.uid || session.email || form.email || "bank";
  const bankEmail = session.email || form.email || authEmail;
  const hasEmailAccount = Boolean(bankEmail && session.emailVerified === true);
  const locationOptions = useMemo(() => locationsForState(form.state), [form.state]);

  const applyRegistrationStatus = (registration = {}) => {
    const nextStatus = registration.status || registration.approvalStatus || "pending";
    if (registration.status === "approved" || registration.approvalStatus === "approved") {
      setApproved(true);
    } else if (nextStatus === "not-submitted" || registration.accountState === "EMAIL_VERIFIED") {
      navigate(registration.redirectTo || "/bank-registration/form", { replace: true });
    } else if (["email-pending", "pending", "submitted", "rejected", "suspended"].includes(nextStatus)) {
      setStatus(nextStatus);
      setStatusMessage(registration.message || "");
      if (registration.redirectTo) navigate(registration.redirectTo, { replace: true });
    } else {
      navigate(registration.redirectTo || "/bank-registration", { replace: true });
    }
  };

  const update = (field, value) => setForm((current) => {
    const next = { ...current, [field]: value };
    if (field === "state") next.branchLocation = "";
    return next;
  });
  const setUpload = (type, value) => setUploads((current) => ({ ...current, [type]: typeof value === "function" ? value(current[type] || {}) : value }));

  const startEmailAccount = async () => {
    if (!authEmail.trim() || !authPassword) {
      setError("Enter email address and password to create your bank account.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const registration = await startBankRegistrationWithEmail({ email: authEmail, password: authPassword });
      setSession(registration);
      setForm((current) => ({ ...current, email: registration.email || current.email }));
      navigate(registration.redirectTo || "/bank-registration/form");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create email/password account.");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!hasEmailAccount || !bankEmail) return setError("Create an email/password account before submitting bank registration.");
    const validation = fieldError({ ...form, email: bankEmail });
    if (validation) return setError(validation);
    setLoading(true);
    try {
      const response = await registerBankPartner({
        email: bankEmail,
        profile: {
          bankUid,
          companyName: form.bankName,
          bankName: form.bankName,
          ifsc: form.ifsc,
          ifscCode: form.ifsc,
          branchIfsc: form.ifsc,
          branchName: form.branchLocation,
          branchLocation: form.branchLocation,
          contactPerson: form.managerName,
          managerName: form.managerName,
          mobile: form.managerMobile,
          officialEmail: bankEmail,
          city: form.branchLocation,
          bankBranchLocation: form.branchLocation,
          state: form.state,
          executiveCount: form.executiveCount,
          monthlyLoanCapacity: form.monthlyLoanCapacity,
          supportedBanks: [form.bankName],
          documents: Object.values(uploads).filter(Boolean),
        },
      });
      const details = { ...form, email: bankEmail, submittedAt: new Date().toISOString(), approvalId: response.approvalId };
      sessionStorage.setItem("cls_bank_pending_details", JSON.stringify(details));
      navigate("/bank-registration/pending-approval");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to register bank partner.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!["verify-email", "pending", "approved", "rejected", "suspended"].includes(mode)) return undefined;
    setPendingDetails(JSON.parse(sessionStorage.getItem("cls_bank_pending_details") || "null"));
    const check = async () => {
      setChecking(true);
      try {
        const registration = await checkBankRegistrationWithEmail({ silent: true });
        applyRegistrationStatus(registration);
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [mode, navigate, checkBankRegistrationWithEmail]);
  usePublicRegistrationStatusSync({
    enabled: ["verify-email", "pending", "approved", "rejected", "suspended"].includes(mode) && ["email-pending", "pending", "submitted"].includes(status) && !approved,
    checkStatus: async () => {
      const registration = await checkBankRegistrationWithEmail({ silent: true });
      applyRegistrationStatus(registration);
    },
  });

  if (["verify-email", "pending", "approved", "rejected", "suspended"].includes(mode)) {
    if (checking) return <BankRegistrationCheckingView />;
    if (approved) return <BankRegistrationApprovedView onLogin={() => navigate("/bank/login")} />;
    return (
      <BankRegistrationStatusView
        bankEmail={bankEmail}
        form={form}
        pendingDetails={pendingDetails}
        status={status}
        statusMessage={statusMessage}
      />
    );
  }
  if (mode === "landing" && audience === "executive") {
    return <BankExecutiveLandingView />;
  }
  if (mode === "landing") {
    return (
      <BankRegistrationLandingView
        authEmail={authEmail}
        authPassword={authPassword}
        error={error}
        loading={loading}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onStartEmailAccount={startEmailAccount}
      />
    );
  }
  return (
    <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <form onSubmit={submit} className="mx-auto max-w-7xl space-y-6">
        <BankEmailVerificationSection bankEmail={bankEmail} hasEmailAccount={hasEmailAccount} onStartEmailAccount={startEmailAccount} />

        <p className={`min-h-11 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 ${error ? "" : "invisible"}`}>{error || "No validation issue"}</p>

        <BankIdentitySection form={form} locationOptions={locationOptions} update={update} />
        <BankManagerDetailsSection bankEmail={bankEmail} form={form} update={update} />
        <BankOperationsSection form={form} update={update} />
        <BankDocumentUploadsSection bankUid={bankUid} setUpload={setUpload} uploads={uploads} />
        <BankManualVerificationSection hasEmailAccount={hasEmailAccount} loading={loading} />
      </form>
    </main>
  );
}




