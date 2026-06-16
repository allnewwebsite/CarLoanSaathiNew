import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, FileCheck2, Loader2, ShieldCheck, UploadCloud } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { bankLoanCapacityRanges, bankStates, locationsForState } from "../../data/bankLocationMaster.js";
import { usePublicRegistrationStatusSync } from "../../hooks/usePublicRegistrationStatusSync.js";

const banks = [
  "State Bank of India (SBI)",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "IndusInd Bank",
  "Punjab National Bank (PNB)",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Bank of India",
  "Indian Bank",
  "Central Bank of India",
  "Bank of Maharashtra",
  "Indian Overseas Bank",
  "UCO Bank",
  "Punjab & Sind Bank",
  "IDFC FIRST Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karnataka Bank",
  "Karur Vysya Bank",
  "Tamilnad Mercantile Bank",
  "RBL Bank",
  "DCB Bank",
  "CSB Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
  "Jana Small Finance Bank",
  "Suryoday Small Finance Bank",
  "ESAF Small Finance Bank",
  "Utkarsh Small Finance Bank",
  "Capital Small Finance Bank",
  "Yes Bank",
  "Other",
];
const executiveCounts = ["1", "2", "3", "5", "10", "15", "20", "25+", "50+"];
const benefits = ["Verified dealership leads", "Branch-wise assignment", "Executive dashboards", "Real-time approvals", "Faster disbursement"];
const workflow = ["Bank Registration", "Super Admin Verification", "Branch Activation", "Executive Mapping", "Lead Assignment", "Loan Processing", "Disbursement"];
const documents = [
  { label: "Branch Authorization Letter", type: "authorization", folder: "authorization" },
  { label: "Address Proof", type: "address-proof", folder: "address-proof" },
  { label: "Manager Identity Card", type: "manager-id", folder: "manager-id" },
];
const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
const maxSize = 10 * 1024 * 1024;

const initialForm = {
  bankName: "",
  ifsc: "",
  branchLocation: "",
  state: "Haryana",
  managerName: "",
  managerMobile: "",
  email: "",
  executiveCount: "",
  monthlyLoanCapacity: "",
};

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

function UploadBox({ doc, bankUid, value, onChange }) {
  const [error, setError] = useState("");

  const upload = async (file) => {
    setError("");
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setError("Only PDF, JPG, JPEG, and PNG files are allowed.");
      return;
    }
    if (file.size > maxSize) {
      setError("Maximum file size is 10MB.");
      return;
    }
    const storagePath = `bank-registration/${bankUid}/${doc.folder}/${Date.now()}-${file.name}`;
    onChange({ status: "uploading", progress: 0, fileName: file.name, storagePath, fileUrl: "" });
    try {
      const { uploadStorageFile } = await import("../../services/firebaseUpload.js");
      const { fileUrl } = await uploadStorageFile({
        file,
        storagePath,
        contentType: file.type,
        onProgress: (progress) => onChange((current) => ({ ...current, progress })),
      });
      onChange({ status: "uploaded", progress: 100, fileName: file.name, storagePath, fileUrl, documentType: doc.type, label: doc.label, size: file.size });
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed.");
      onChange((current) => ({ ...current, status: "error" }));
    }
  };

  const remove = async () => {
    if (value?.storagePath) {
      try {
        const { deleteStoragePath } = await import("../../services/firebaseUpload.js");
        await deleteStoragePath(value.storagePath);
      } catch {
        // File may already be gone; UI state should still clear.
      }
    }
    onChange(null);
  };

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-[#0d47a1]"><UploadCloud className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{doc.label}</p>
            <p className="mt-1 text-xs text-slate-500">Optional for now. PDF, JPG, JPEG, PNG up to 10MB</p>
          </div>
        </div>
        {value?.status === "uploaded" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
      </div>
      <input className="mt-4 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => upload(event.target.files?.[0])} />
      {value && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
            <span className="truncate">{value.fileName}</span>
            <span>{value.progress || 0}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 rounded-full bg-[#0d47a1]" style={{ width: `${value.progress || 0}%` }} /></div>
          <div className="mt-3 flex gap-2">
            {value.fileUrl && <a href={value.fileUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Preview</a>}
            <button type="button" onClick={remove} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">Remove</button>
          </div>
        </div>
      )}
      <p className={`validation-slot mt-2 ${error ? "" : "validation-slot-empty"}`}>{error || "No validation issue"}</p>
    </div>
  );
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
    if (checking) return <main className="flex min-h-[calc(100vh-88px)] w-full items-center justify-center bg-slate-50 px-4 py-12"><section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">Checking bank registration status...</section></main>;
    if (approved) {
      return (
        <main className="flex min-h-[calc(100vh-88px)] w-full items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
          <section className="mx-auto w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><ShieldCheck className="h-8 w-8" /></span>
            <h1 className="mt-5 text-2xl font-semibold text-slate-900">Bank Account Verified Successfully</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">Your bank partner account has been approved successfully by CarLoanSaathi. You can now access the Bank Manager portal.</p>
            <button type="button" onClick={() => navigate("/bank/login")} className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Login to Bank Portal</button>
          </section>
        </main>
      );
    }
    const statusCopy = {
      "email-pending": {
        title: "Verify Your Email",
        body: "We sent a verification link to your bank email address. Verify it before completing branch registration.",
        badge: "Email Verification Pending",
        steps: [["Done", "Email account created"], ["Pending", "Email verification"], ["Next", "Complete branch registration"]],
      },
      rejected: {
        title: "Registration Rejected",
        body: statusMessage || "Your bank branch registration was rejected by CarLoanSaathi.",
        badge: "Rejected",
        steps: [["Done", "Email verified"], ["Done", "Branch reviewed"], ["Rejected", "Approval not granted"]],
      },
      suspended: {
        title: "Account Suspended",
        body: statusMessage || "Your bank branch account is suspended. Contact CarLoanSaathi support for next steps.",
        badge: "Suspended",
        steps: [["Done", "Email verified"], ["Done", "Account reviewed"], ["Suspended", "Portal access blocked"]],
      },
      pending: {
        title: "Registration submitted successfully",
        body: "Your bank branch registration is under CarLoanSaathi Super Admin verification. Login access will open automatically after approval.",
        badge: "Pending Super Admin Verification",
        steps: [["Done", "Email verified"], ["Done", "Branch details submitted"], ["Pending", "Super Admin verification"], ["Next", "Bank portal activation"]],
      },
      submitted: {
        title: "Registration submitted successfully",
        body: "Your bank branch registration is under CarLoanSaathi Super Admin verification. Login access will open automatically after approval.",
        badge: "Pending Super Admin Verification",
        steps: [["Done", "Email verified"], ["Done", "Branch details submitted"], ["Pending", "Super Admin verification"], ["Next", "Bank portal activation"]],
      },
    };
    const copy = statusCopy[status] || statusCopy.pending;
    return (
      <main className="min-h-[calc(100vh-88px)] w-full bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
        <section className="mx-auto grid max-w-5xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
          <div>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[#0d47a1]"><ShieldCheck className="h-8 w-8" /></span>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank branch onboarding</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{copy.title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{copy.body}</p>
            <p className="mt-5 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{copy.badge}</p>
            {status === "email-pending" && (
              <button type="button" onClick={() => window.location.reload()} className="mt-5 block h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700">I Verified My Email</button>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Submission Summary</h2>
            <div className="mt-4 grid gap-3">
              {[
                ["Bank", pendingDetails?.bankName || form.bankName || "-"],
                ["Location", pendingDetails?.branchLocation || "-"],
                ["Registered Email", pendingDetails?.email || bankEmail || "-"],
                ["Submitted", pendingDetails?.submittedAt ? new Date(pendingDetails.submittedAt).toLocaleString() : "-"],
              ].map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-2"><p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>)}
            </div>
          </div>
        </section>
        <section className="mx-auto mt-5 max-w-5xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Approval Workflow</h2>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
            {copy.steps.map(([stepStatus, label]) => (
              <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
                <span className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${stepStatus === "Done" ? "bg-emerald-50 text-emerald-700" : stepStatus === "Rejected" || stepStatus === "Suspended" ? "bg-red-50 text-red-700" : stepStatus === "Pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{stepStatus}</span>
                <p>{label}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (mode === "landing" && audience === "executive") {
    return (
      <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto grid max-w-6xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-80 flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Loan Executive Registration</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">Bank-side Executive Access</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
              For bank-side executives managing assigned customer loan applications.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
              Loan executive accounts are created and governed by the approved bank branch manager from the bank dashboard, preserving the existing approval workflow and RBAC model.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link to="/executive/login" className="inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Loan Executive Login</Link>
              <Link to="/bank/register" className="inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">Register Bank Branch</Link>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Executive Access Workflow</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Secure bank-managed onboarding</h2>
            <div className="mt-4 space-y-2">
              {["Bank branch approval", "Branch manager creates executive", "Executive receives role-based access", "Assigned leads become visible"].map((step, index) => (
                <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  <span className="flex h-6 w-8 items-center justify-center rounded-md bg-slate-50 text-xs">{index + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "landing") {
    return (
      <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <section className="mx-auto grid max-w-7xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-96 flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank Partner Onboarding Portal</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">Partner with CarLoanSaathi</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">Register your banking branch network to receive dealership finance leads, manage executives, process automotive loans, and track approvals in real-time.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{benefits.map((item) => <div key={item} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">{item}</div>)}</div>
            <p className={`mt-5 min-h-11 rounded-lg px-4 py-3 text-sm font-semibold ${error ? "bg-red-50 text-red-700" : "invisible bg-red-50 text-red-700"}`}>{error || "No validation issue"}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <input type="email" placeholder="Email Address" className="field h-11 rounded-md" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
              <input type="password" placeholder="Password" className="field h-11 rounded-md" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
            </div>
            <button disabled={loading} onClick={startEmailAccount} className="mt-6 inline-flex h-11 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-70">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}</button>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Onboarding Workflow</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Bank branch activation</h2>
            <div className="mt-4 space-y-2">{workflow.map((step, index) => <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"><span className="flex h-6 w-8 items-center justify-center rounded-md bg-slate-50 text-xs">{index + 1}</span>{step}</div>)}</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <form onSubmit={submit} className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Email Account Verification</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
              <div><p className="text-sm font-semibold text-slate-900">{hasEmailAccount ? bankEmail : "Email account not verified"}</p><p className="text-xs text-slate-500">{hasEmailAccount ? "Verified email/password session active" : "Verify email before submitting"}</p></div>
            </div>
            <button type="button" onClick={startEmailAccount} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700">Create Account</button>
          </div>
        </section>

        <p className={`min-h-11 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 ${error ? "" : "invisible"}`}>{error || "No validation issue"}</p>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4"><FileCheck2 className="h-5 w-5 text-[#0d47a1]" /><h1 className="text-xl font-semibold text-slate-950">Bank Registration Form</h1></div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Name of Bank *<select required className="field mt-2" value={form.bankName} onChange={(event) => update("bankName", event.target.value)}><option value="">Select bank</option>{banks.map((bank) => <option key={bank}>{bank}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Branch IFSC Code *<input required className="field mt-2 uppercase" value={form.ifsc} onChange={(event) => update("ifsc", event.target.value.toUpperCase())} /></label>
            <label className="text-sm font-medium text-slate-700">State *<select required className="field mt-2" value={form.state} onChange={(event) => update("state", event.target.value)}><option value="">Select state</option>{bankStates.map((state) => <option key={state}>{state}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Bank Branch Location *<select required className="field mt-2" value={form.branchLocation} onChange={(event) => update("branchLocation", event.target.value)}><option value="">Select location</option>{locationOptions.map((location) => <option key={location}>{location}</option>)}</select></label>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Manager Details</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Bank Manager Name *<input required className="field mt-2" value={form.managerName} onChange={(event) => update("managerName", event.target.value)} /></label>
            <label className="text-sm font-medium text-slate-700">
              Bank Manager Contact Number *
              <div className="mt-2 flex h-10 overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-[#0d47a1]">
                <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
                <input required inputMode="numeric" maxLength={10} className="h-full w-full px-3 outline-none" value={form.managerMobile} onChange={(event) => update("managerMobile", event.target.value.replace(/\D/g, "").slice(0, 10))} />
              </div>
            </label>
            <label className="text-sm font-medium text-slate-700">Official Bank Email *<input required readOnly disabled type="email" className="field mt-2 bg-slate-50 text-slate-600" value={bankEmail || form.email} /></label>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Branch Operations</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Number of Loan Executives *<select required className="field mt-2" value={form.executiveCount} onChange={(event) => update("executiveCount", event.target.value)}><option value="">Select count</option>{executiveCounts.map((count) => <option key={count}>{count}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Monthly Loan Capacity *<select required className="field mt-2" value={form.monthlyLoanCapacity} onChange={(event) => update("monthlyLoanCapacity", event.target.value)}><option value="">Select capacity</option>{bankLoanCapacityRanges.map((capacity) => <option key={capacity}>{capacity}</option>)}</select></label>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Bank Document Uploads</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">{documents.map((doc) => <UploadBox key={doc.type} doc={doc} bankUid={bankUid} value={uploads[doc.type]} onChange={(value) => setUpload(doc.type, value)} />)}</div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#0d47a1]" /><div><h2 className="text-base font-semibold text-slate-950">All bank registrations are verified manually by CarLoanSaathi Super Admin before activation.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Secure onboarding, branch verification, document checks, and executive mapping are completed before bank portal access is enabled.</p></div></div>
          <button disabled={loading || !hasEmailAccount} className="mt-6 flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-semibold text-white disabled:opacity-70">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit for Super Admin Approval"}</button>
        </section>
      </form>
    </main>
  );
}
