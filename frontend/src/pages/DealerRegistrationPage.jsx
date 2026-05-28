import { CheckCircle2, ChevronDown, Eye, EyeOff, FileCheck2, Landmark, Loader2, Search, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { doc as firestoreDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Toast } from "../components/ui/Toast.jsx";
import { brandLogos } from "../data/catalogFallback.js";
import { api } from "../services/api.js";
import { auth } from "../services/firebase.js";
import { db } from "../services/firebaseDb.js";
import { storage } from "../services/firebaseStorage.js";
import { useAuth } from "../context/AuthContext.jsx";

const cities = ["Bahadurgarh", "Jhajjar", "Rohtak", "Sonipat", "Beri", "Gurugram", "Jind", "Manesar", "Gohana", "Murthal", "Panipat"];
const dealershipBrands = ["Tata Motors", "Hyundai", "Kia", "Mahindra", "Maruti Suzuki", "Toyota", "Honda", "MG", "Skoda", "Volkswagen", "Nissan", "Renault", "BMW", "Audi", "Mercedes-Benz", "Volvo"];
const financeTeamSizes = ["1-2", "3-5", "5-10", "10+"];
const salesCapacity = ["10+", "25+", "50+", "70+", "100+", "200+"];
const fallbackBanks = ["HDFC Bank", "ICICI Bank", "Axis Bank", "State Bank of India", "Kotak Mahindra Bank", "IndusInd Bank", "Bank of Baroda", "Punjab National Bank", "IDFC First Bank", "AU Small Finance Bank", "Yes Bank", "Union Bank"];
const documentFields = ["GST Certificate", "Dealership License", "Office Exterior Photo", "Office Interior Photo"];
const documentConfig = {
  "GST Certificate": { type: "gst-certificate", folder: "gst" },
  "Dealership License": { type: "dealership-license", folder: "license" },
  "Office Exterior Photo": { type: "office-exterior", folder: "office-exterior" },
  "Office Interior Photo": { type: "office-interior", folder: "office-interior" },
};
const allowedDocumentTypes = ["application/pdf", "image/jpeg", "image/png"];
const maxDocumentSize = 10 * 1024 * 1024;
const benefitCards = [
  "Multi-bank finance processing",
  "Faster loan approvals",
  "Real-time case tracking",
  "Finance desk management",
  "City-based lead routing",
  "Salesperson performance visibility",
  "Secure document workflow",
  "Bank SLA monitoring",
];
const supportedBanks = ["HDFC Bank", "ICICI Bank", "Axis Bank", "SBI", "Kotak", "PNB", "Bank of Baroda", "IndusInd"];
const workflow = ["Customer", "Salesperson", "Finance Desk", "CarLoanSaathi", "Bank", "Approval", "Disbursement"];

const initialForm = {
  dealershipName: "",
  dealershipBrand: "",
  authorizedDealerCode: "",
  gstin: "",
  officialDealershipEmail: "",
  officialDealershipMobile: "",
  ownerFullName: "",
  ownerMobile: "",
  ownerEmail: "",
  gmName: "",
  gmMobile: "",
  gmEmail: "",
  financeHeadName: "",
  financeHeadMobile: "",
  financeDeskEmail: "",
  financeTeamSize: "",
  state: "Haryana",
  city: "",
  pincode: "",
  address: "",
  landmark: "",
  monthlyCarSalesCapacity: "",
  expectedMonthlyLoanApplications: "",
  existingBankTieUps: "",
  preferredPartnerBanks: [],
  loginEmail: "",
};

function SelectBox({ label, value, options, onChange, placeholder = "Select", error }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const selected = [value].filter(Boolean);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return options.filter((option) => !search || option.toLowerCase().includes(search));
  }, [options, query]);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (option) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <label ref={ref} className="relative text-sm font-medium text-slate-700">
      {label}
      <button type="button" onClick={() => setOpen((current) => !current)} className={`mt-1.5 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm font-normal text-slate-900 outline-none transition hover:border-slate-400 ${error ? "border-red-300" : "border-slate-300"}`}>
        <span className={`min-w-0 truncate ${selected.length ? "" : "text-[#64748b]"}`}>{selected.length ? selected.join(", ") : placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#edf2f7] px-3 py-2">
            <Search className="h-4 w-4 text-[#64748b]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#06152f] outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((option) => (
              <button key={option} type="button" onClick={() => choose(option)} className={`block w-full px-3 py-2 text-left text-sm font-normal transition hover:bg-slate-50 ${selected.includes(option) ? "bg-blue-50 text-[#0d47a1]" : "text-slate-800"}`}>
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </label>
  );
}

function StandardSelect({ label, value, options, onChange, placeholder = "Select", error, required = true }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        required={required}
        className={`field mt-1.5 h-10 rounded-md bg-white ${error ? "border-red-300" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </label>
  );
}

function BankMultiSelect({ label, value, options, onChange, placeholder = "Select banks", error }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = Array.isArray(value) ? value : [];

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = (bank) => {
    onChange(selected.includes(bank) ? selected.filter((item) => item !== bank) : [...selected, bank]);
  };

  return (
    <div ref={ref} className="relative min-w-0 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`mt-1.5 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm font-normal text-slate-900 outline-none transition hover:border-slate-400 ${error ? "border-red-300" : "border-slate-300"}`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selected.length ? selected.slice(0, 3).map((bank) => (
            <span key={bank} className="max-w-full truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#0d47a1]">{bank}</span>
          )) : <span className="px-1 text-[#64748b]">{placeholder}</span>}
          {selected.length > 3 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">+{selected.length - 3}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.length ? options.map((bank) => (
            <label key={bank} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-normal text-slate-800 transition hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[#cfd8e3] accent-[#0d47a1]"
                checked={selected.includes(bank)}
                onChange={() => toggle(bank)}
              />
              <span className="min-w-0 flex-1 truncate">{bank}</span>
            </label>
          )) : (
            <p className="rounded-xl bg-[#f8fbff] px-3 py-4 text-sm font-semibold text-[#536173]">No partner banks available yet.</p>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

function SectionCard({ number, title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0d47a1] text-xs font-medium text-white">{number}</span>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

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
      const registration = await startDealerRegistrationWithEmail({ email: authEmail, password: authPassword });
      if (registration.status === "submitted") {
        navigate("/dealer-registration/pending");
      } else {
        navigate("/dealer-registration/form");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create email/password account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.05fr_0.95fr] lg:p-6">
          <div className="flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{onboardingEyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{onboardingTitle}</h1>
            <p className="mt-3 text-lg font-medium text-slate-700">{onboardingSubtitle}</p>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              {onboardingBody}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Email Address<input type="email" className="field mt-1.5 h-11 rounded-md" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
              <label className="text-sm font-medium text-slate-700">
                Password
                <div className="field mt-1.5 flex h-11 items-center gap-2 rounded-md bg-white px-3">
                  <input type={showAuthPassword ? "text" : "password"} className="min-w-0 flex-1 bg-transparent outline-none" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  <button type="button" onClick={() => setShowAuthPassword((current) => !current)} className="text-slate-500" aria-label={showAuthPassword ? "Hide password" : "Show password"}>
                    {showAuthPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button onClick={beginRegistration} disabled={loading} className="inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-70">
                {loading ? "Creating account..." : "Create Account"}
              </button>
              <a href="#benefits" className="inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">Explore Benefits</a>
            </div>
            {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="rounded-lg bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Operational workflow</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-900">Dealership to disbursement</h2>
                </div>
                <Landmark className="h-5 w-5 text-[#0d47a1]" />
              </div>
              <div className="mt-4 grid gap-2">
                {workflow.map((step, index) => (
                  <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-medium text-[#0d47a1]">{index + 1}</span>
                    <span className="text-sm font-medium text-slate-700">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="benefits" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Benefits</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Why dealerships partner with CarLoanSaathi</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {benefitCards.map((benefit) => (
              <div key={benefit} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <p className="mt-3 text-sm font-medium text-slate-800">{benefit}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">How it works</p>
            <div className="mt-4 grid gap-3">
              {["Register dealership", "Get approval from CarLoanSaathi", "Finance desk starts submitting leads", "Track approvals and disbursement live"].map((step, index) => (
                <div key={step} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#0d47a1] text-xs font-medium text-white">{index + 1}</span>
                  <p className="text-sm font-medium text-slate-800">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank network</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Supported partner banks</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {supportedBanks.map((bank) => (
                <div key={bank} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-medium text-slate-700">{bank}</div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-8 w-8 text-[#0d47a1]" />
          <h2 className="mt-3 text-xl font-semibold text-slate-900">{isFinanceAudience ? "Ready to register the finance head account?" : "Ready to onboard your dealership?"}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {isFinanceAudience
              ? "Create the official dealership finance email/password account first. Dashboard access starts only after Super Admin approval."
              : "Create your official email/password account first. Dashboard access starts only after Super Admin approval."}
          </p>
          <div className="mx-auto mt-5 grid max-w-xl gap-3 sm:grid-cols-2">
            <input type="email" placeholder="Email Address" className="field h-11 rounded-md" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
            <div className="field flex h-11 items-center gap-2 rounded-md bg-white px-3">
              <input type={showAuthPassword ? "text" : "password"} placeholder="Password" className="min-w-0 flex-1 bg-transparent outline-none" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
              <button type="button" onClick={() => setShowAuthPassword((current) => !current)} className="text-slate-500" aria-label={showAuthPassword ? "Hide password" : "Show password"}>
                {showAuthPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button onClick={beginRegistration} disabled={loading} className="mt-5 inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-6 text-sm font-medium text-white disabled:opacity-70">
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </section>
      </div>
    </main>
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
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
          Checking dealership approval...
        </section>
      </main>
    );
  }

  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Dealership Verified Successfully</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your dealership account has been approved successfully by CarLoanSaathi.
        </p>
        <Link to="/dealer/login" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">
          Login to Dealer Portal
        </Link>
      </section>
    </main>
  );
}

export function DealerRegistrationPendingPage() {
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const { checkDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  const checkStatus = async () => {
    setChecking(true);
    setMessage("");
    try {
      const registration = await checkDealerRegistrationWithEmail();
      const pending = registration.status === "pending" || registration.approvalStatus === "pending" || registration.status === "submitted";
      if (registration.status === "approved" || registration.approvalStatus === "approved") {
        setApproved(true);
      } else if (!pending) {
        navigate(registration.redirectTo || "/dealer-registration", { replace: true });
      } else if (registration.redirectTo && registration.redirectTo !== "/dealer-registration/pending") {
        navigate(registration.redirectTo, { replace: true });
      } else {
        setMessage(registration.message || "Your dealership account is still pending approval.");
      }
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || "Unable to check approval status.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const checkSilently = async () => {
      setChecking(true);
      try {
        const registration = await checkDealerRegistrationWithEmail({ silent: true });
        const pending = registration.status === "pending" || registration.approvalStatus === "pending" || registration.status === "submitted";
        if (registration.status === "approved" || registration.approvalStatus === "approved") setApproved(true);
        else if (!pending) navigate(registration.redirectTo || "/dealer-registration", { replace: true });
        else if (registration.redirectTo && registration.redirectTo !== "/dealer-registration/pending") navigate(registration.redirectTo, { replace: true });
      } finally {
        setChecking(false);
      }
    };
    checkSilently();
  }, []);

  if (approved) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Dealership Verified Successfully</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your dealership account has been approved successfully by CarLoanSaathi.
          </p>
          <div className="mt-6 space-y-2 text-left">
            {["Account verified", "Dealership activated", "Dashboard access enabled"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <span className="flex h-6 w-16 items-center justify-center rounded-full bg-emerald-50 text-xs text-emerald-700">Done</span>
                {item}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => navigate("/dealer/login")} className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">
            Login to Dealer Portal
          </button>
        </section>
      </main>
    );
  }

  if (checking) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
          Checking dealership approval...
        </section>
      </main>
    );
  }

  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Approval Pending</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your dealership registration has been submitted successfully and is under verification by CarLoanSaathi.
        </p>
        <div className="mt-6 space-y-2 text-left">
          {["Email account created", "Registration submitted", "Waiting for admin verification"].map((item, index) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <span className={`flex h-6 w-16 items-center justify-center rounded-full text-xs ${index < 2 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{index < 2 ? "Done" : "Pending"}</span>
              {item}
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">You cannot login until your dealership is approved by Super Admin.</p>
        {message && <p className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-[#0d47a1]">{message}</p>}
        <Link to="/" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Return to Homepage</Link>
      </section>
    </main>
  );
}

export function DealerRegistrationFormPage() {
  const { firebaseUser, isAuthenticated } = useAuth();
  const [registrationSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("cls_dealer_registration") || "{}");
    } catch {
      return {};
    }
  });
  const [form, setForm] = useState(() => ({
    ...initialForm,
    loginEmail: registrationSession.email || "",
    financeDeskEmail: registrationSession.email || "",
  }));
  const [banks, setBanks] = useState([]);
  const [documents, setDocuments] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const dealerUid = firebaseUser?.uid || auth.currentUser?.uid || registrationSession.uid || registrationSession.registrationId || registrationSession.email || "";
  const dealerEmail = firebaseUser?.email || auth.currentUser?.email || registrationSession.email || "";

  useEffect(() => {
    api.get("/banks")
      .then((response) => {
        const bankNames = (response.data || []).map((bank) => bank.name).filter(Boolean);
        setBanks(bankNames.length ? bankNames : fallbackBanks);
      })
      .catch(() => setBanks(fallbackBanks));
  }, []);

  const hasVerifiedEmail = Boolean(
    dealerEmail
    && (
      auth.currentUser
      || firebaseUser
      || isAuthenticated
      || registrationSession.registrationId
      || registrationSession.email
    )
  );

  useEffect(() => {
    if (dealerEmail) {
      setForm((current) => ({
        ...current,
        loginEmail: current.loginEmail || dealerEmail,
        financeDeskEmail: current.financeDeskEmail || dealerEmail,
      }));
    }
  }, [dealerEmail]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "officialDealershipEmail" && !form.loginEmail) {
      setForm((current) => ({ ...current, officialDealershipEmail: value, loginEmail: value }));
    }
  };

  const fieldClass = "field mt-1.5 h-10 rounded-md";
  const labelClass = "text-sm font-medium text-slate-700";

  const setDocument = async (name, file) => {
    if (!file) return;
    const config = documentConfig[name];
    if (!config) return;
    if (!allowedDocumentTypes.includes(file.type)) {
      setError("Only PDF, JPG, JPEG, and PNG files are allowed.");
      return;
    }
    if (file.size > maxDocumentSize) {
      setError("Document size must be 10MB or less.");
      return;
    }
    const uid = dealerUid || auth.currentUser?.uid;
    if (!uid) {
      setError("Create an email/password account before uploading dealership documents.");
      return;
    }
    setError("");
    const safeName = `${Date.now()}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `dealer-registration/${uid}/${config.folder}/${safeName}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

    setDocuments((current) => ({
      ...current,
      [name]: { file, progress: 0, status: "uploading", storagePath, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" },
    }));

    task.on("state_changed", (snapshot) => {
      const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      setDocuments((current) => ({ ...current, [name]: { ...current[name], progress, status: "uploading" } }));
    }, (uploadError) => {
      setDocuments((current) => ({ ...current, [name]: { ...current[name], status: "error", error: uploadError.message } }));
      setError(uploadError.message || "Document upload failed. Please retry.");
    }, async () => {
      const fileUrl = await getDownloadURL(task.snapshot.ref);
      const metadata = {
        dealerUid: uid,
        documentType: config.type,
        fileName: file.name,
        fileUrl,
        storagePath,
        uploadedAt: serverTimestamp(),
        verified: false,
      };
      try {
        await setDoc(firestoreDoc(db, "dealerRegistrationDocuments", `${uid}-${config.type}`), metadata, { merge: true });
      } catch (metadataError) {
        console.warn("Dealer registration document metadata write skipped", metadataError);
      }
      setDocuments((current) => ({
        ...current,
        [name]: { ...current[name], progress: 100, status: "uploaded", fileUrl, storagePath, documentType: config.type },
      }));
    });
  };

  const removeDocument = async (event, name) => {
    event.preventDefault();
    event.stopPropagation();
    const document = documents[name];
    if (document?.storagePath) {
      try {
        await deleteObject(ref(storage, document.storagePath));
      } catch {
        // Metadata cleanup is best-effort; stale failed deletes should not block the user.
      }
    }
    setDocuments((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const validate = () => {
    const requiredFields = [
      ["dealershipName", "Dealership Name"],
      ["dealershipBrand", "Dealership Brand"],
      ["authorizedDealerCode", "Authorized Dealer Code"],
      ["gstin", "GSTIN Number"],
      ["officialDealershipEmail", "Official Dealership Email"],
      ["officialDealershipMobile", "Official Dealership Mobile Number"],
      ["ownerFullName", "Owner Full Name"],
      ["ownerMobile", "Owner Mobile Number"],
      ["ownerEmail", "Owner Official Email"],
      ["gmName", "General Manager Name"],
      ["gmMobile", "GM Mobile Number"],
      ["gmEmail", "GM Official Email"],
      ["financeHeadName", "Finance Desk Head Name"],
      ["financeHeadMobile", "Finance Desk Head Mobile Number"],
      ["financeDeskEmail", "Finance Desk Official Email"],
      ["financeTeamSize", "Finance Team Size"],
      ["city", "City"],
      ["pincode", "Pincode"],
      ["address", "Full Dealership Address"],
      ["monthlyCarSalesCapacity", "Monthly Car Sales Capacity"],
      ["expectedMonthlyLoanApplications", "Expected Monthly Loan Applications"],
      ["loginEmail", "Official Login Email"],
    ];
    const missing = requiredFields.find(([field]) => !String(form[field] || "").trim());
    if (missing) return `${missing[1]} is required.`;
    if (!cities.includes(form.city)) return "Please select a supported dealership city.";
    if (!form.preferredPartnerBanks.length) return "Please select at least one preferred partner bank.";
    if (!hasVerifiedEmail || !dealerEmail) return "Create an email/password account before submitting dealership registration.";
    return "";
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        registrationId: registrationSession.registrationId,
        loginEmail: dealerEmail,
        financeDeskEmail: dealerEmail,
        dealerUid,
        documents: Object.entries(documents).filter(([, item]) => item.status === "uploaded").map(([type, item]) => ({
          type,
          documentType: item.documentType,
          fileName: item.file.name,
          size: item.file.size,
          fileUrl: item.fileUrl,
          storagePath: item.storagePath,
        })),
      };
      const response = await api.post("/dealer/register", payload);
      try {
        await setDoc(firestoreDoc(db, "dealerRegistrations", dealerUid), {
          dealerUid,
          email: dealerEmail,
          dealershipName: form.dealershipName,
          dealerBrand: form.dealershipBrand,
          city: form.city,
          mobile: form.officialDealershipMobile,
          registrationStatus: "pending-approval",
          submittedAt: serverTimestamp(),
        }, { merge: true });
        await setDoc(firestoreDoc(db, "pendingDealerAccounts", dealerUid), {
          uid: dealerUid,
          email: dealerEmail,
          approvalStatus: "pending",
          registrationCompleted: true,
          registrationSubmitted: true,
          accountApproved: false,
          accountActive: false,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (metadataError) {
        console.warn("Dealer registration client metadata write skipped", metadataError);
      }
      setSuccess(`${response.data.message} Request ID: ${response.data.onboardingRequestId}`);
      navigate("/dealer-registration/pending-approval");
    } catch (err) {
      const serverMessage = err.response?.data?.message || err.response?.data?.error;
      const networkMessage = err.code === "ERR_NETWORK" ? "Backend is not reachable. Please check VITE_API_BASE_URL and backend deployment." : "";
      setError(serverMessage || networkMessage || err.message || "Unable to submit onboarding request.");
    } finally {
      setLoading(false);
    }
  };

  if (!hasVerifiedEmail) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-8 w-8 text-[#0d47a1]" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Email account required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Start from the dealer onboarding page so your official email can become the primary dealership login.</p>
          <Link to="/dealer-registration" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white">Go to Dealer Registration</Link>
        </section>
      </main>
    );
  }

  if (success) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Registration Submitted Successfully</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Your dealership onboarding request has been submitted to CarLoanSaathi for verification and approval.</p>
          <div className="mt-6 space-y-2 text-left">
            {["Email account created", "Registration submitted", "Admin approval pending"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <span className={`flex h-6 w-16 items-center justify-center rounded-full text-xs ${index < 2 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{index < 2 ? "Done" : "Pending"}</span>
                {item}
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-600">Your dealership registration has been submitted successfully and is currently under verification by CarLoanSaathi. You cannot login until your dealership is approved by Super Admin.</p>
          <Link to="/dealer-registration/pending" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">View Approval Pending Status</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Email account created successfully for {registrationSession.email}. Complete the dealership registration to request Super Admin approval.
        </div>
        <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 lg:grid-cols-[1.05fr_0.95fr] lg:p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Authorized dealership onboarding</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">Partner with CarLoanSaathi</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">India's smart automotive finance network for dealership finance desks.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {["25+ Partner Banks", "City-based Lead Distribution", "Real-time Dashboard", "Faster Approvals"].map((item) => (
                <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">{item}</div>
              ))}
            </div>
          </div>
          <div className="relative min-h-56 overflow-hidden rounded-lg bg-slate-50 p-5">
            <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-lg bg-white"><Landmark className="h-5 w-5 text-[#0d47a1]" /></div>
            <div className="mt-14 rounded-lg bg-white p-4">
              <Sparkles className="h-6 w-6 text-[#0d47a1]" />
              <p className="mt-3 text-lg font-semibold text-slate-900">Finance desk onboarding</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Verified dealership identity, city mapping, bank preferences, and document readiness.</p>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Workflow</h2>
          <div className="mt-4 grid gap-2 md:grid-cols-6">
            {["Customer", "Salesperson", "Finance Desk", "CarLoanSaathi", "Bank", "Approval / Disbursement"].map((step) => (
              <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-medium text-slate-700">{step}</div>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Toast message={success} type="success" />
            <Toast message={error} type="error" />

            <SectionCard number="1" title="Dealership Information">
              <label className={labelClass}>Dealership Name *<input required className={fieldClass} value={form.dealershipName} onChange={(e) => update("dealershipName", e.target.value)} /></label>
              <SelectBox label="Dealership Brand *" value={form.dealershipBrand} options={dealershipBrands} onChange={(value) => update("dealershipBrand", value)} />
              <label className={labelClass}>Authorized Dealer Code *<input required className={fieldClass} value={form.authorizedDealerCode} onChange={(e) => update("authorizedDealerCode", e.target.value)} /></label>
              <label className={labelClass}>GSTIN Number *<input required className={fieldClass} value={form.gstin} onChange={(e) => update("gstin", e.target.value.toUpperCase())} /></label>
              <label className={labelClass}>Official Dealership Email *<input required type="email" className={fieldClass} value={form.officialDealershipEmail} onChange={(e) => update("officialDealershipEmail", e.target.value)} /></label>
              <label className={labelClass}>Official Dealership Mobile Number *<input required className={fieldClass} value={form.officialDealershipMobile} onChange={(e) => update("officialDealershipMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
            </SectionCard>

            <SectionCard number="2" title="Owner Details">
              <label className={labelClass}>Owner Full Name *<input required className={fieldClass} value={form.ownerFullName} onChange={(e) => update("ownerFullName", e.target.value)} /></label>
              <label className={labelClass}>Owner Mobile Number *<input required className={fieldClass} value={form.ownerMobile} onChange={(e) => update("ownerMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
              <label className={`${labelClass} md:col-span-2`}>Owner Official Email *<input required type="email" className={fieldClass} value={form.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} /></label>
            </SectionCard>

            <SectionCard number="3" title="General Manager Details">
              <label className={labelClass}>General Manager Name *<input required className={fieldClass} value={form.gmName} onChange={(e) => update("gmName", e.target.value)} /></label>
              <label className={labelClass}>GM Mobile Number *<input required className={fieldClass} value={form.gmMobile} onChange={(e) => update("gmMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
              <label className={`${labelClass} md:col-span-2`}>GM Official Email *<input required type="email" className={fieldClass} value={form.gmEmail} onChange={(e) => update("gmEmail", e.target.value)} /></label>
            </SectionCard>

            <SectionCard number="4" title="Finance Desk Details">
              <label className={labelClass}>Finance Desk Head Name *<input required className={fieldClass} value={form.financeHeadName} onChange={(e) => update("financeHeadName", e.target.value)} /></label>
              <label className={labelClass}>Finance Desk Head Mobile Number *<input required className={fieldClass} value={form.financeHeadMobile} onChange={(e) => update("financeHeadMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
              <label className={labelClass}>Finance Desk Official Email *<input required readOnly type="email" className={`${fieldClass} bg-slate-50`} value={form.financeDeskEmail} /></label>
              <StandardSelect label="Finance Team Size *" value={form.financeTeamSize} options={financeTeamSizes} onChange={(value) => update("financeTeamSize", value)} placeholder="Select team size" />
            </SectionCard>

            <SectionCard number="5" title="Dealership Location">
              <label className={labelClass}>State<input disabled className={`${fieldClass} bg-[#f5f7fb]`} value={form.state} /></label>
              <SelectBox label="City *" value={form.city} options={cities} onChange={(value) => update("city", value)} placeholder="Search supported city" />
              <label className={labelClass}>Pincode *<input required className={fieldClass} value={form.pincode} onChange={(e) => update("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <label className={labelClass}>Landmark<input className={fieldClass} value={form.landmark} onChange={(e) => update("landmark", e.target.value)} /></label>
              <label className={`${labelClass} md:col-span-2`}>Full Dealership Address *<textarea required className="field mt-2 min-h-28 rounded-2xl py-3" value={form.address} onChange={(e) => update("address", e.target.value)} /></label>
            </SectionCard>

            <SectionCard number="6" title="Business & Loan Capacity">
              <StandardSelect label="Monthly Car Sales Capacity *" value={form.monthlyCarSalesCapacity} options={salesCapacity} onChange={(value) => update("monthlyCarSalesCapacity", value)} placeholder="Select monthly capacity" />
              <label className={labelClass}>Expected Monthly Loan Applications *<input required type="number" className={fieldClass} value={form.expectedMonthlyLoanApplications} onChange={(e) => update("expectedMonthlyLoanApplications", e.target.value)} /></label>
              <label className={labelClass}>Existing Bank Tie-ups<input className={fieldClass} value={form.existingBankTieUps} onChange={(e) => update("existingBankTieUps", e.target.value)} placeholder="None, or list current bank tie-ups" /></label>
              <BankMultiSelect label="Preferred Partner Banks *" value={form.preferredPartnerBanks} options={banks} onChange={(value) => update("preferredPartnerBanks", value)} />
            </SectionCard>

            <SectionCard number="7" title="Document Uploads">
              <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal leading-6 text-slate-600">
                Optional during registration. You can upload dealership verification documents later after testing the required details.
              </div>
              {documentFields.map((doc) => (
                <label key={doc} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-medium text-slate-700">
                  <div className="flex items-center gap-3"><UploadCloud className="h-5 w-5" /> {doc}</div>
                  <input type="file" className="mt-3 block w-full text-xs" accept=".pdf,image/jpeg,image/png" onChange={(e) => setDocument(doc, e.target.files?.[0])} />
                  {documents[doc] && (
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-[#536173]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {documents[doc].status === "uploading" ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-[#0d47a1]" /> : <FileCheck2 className="mr-2 inline h-4 w-4 text-emerald-600" />}
                          {documents[doc].file.name}
                        </span>
                        <span className="shrink-0 font-semibold text-[#0d47a1]">{documents[doc].progress || 0}%</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-[#dbe7f6]"><div className="h-1.5 rounded-full bg-[#0d47a1]" style={{ width: `${documents[doc].progress || 0}%` }} /></div>
                      {documents[doc].status === "error" && <p className="mt-2 text-red-600">{documents[doc].error || "Upload failed"}</p>}
                      <div className="mt-2 flex gap-2">
                        {documents[doc].status === "error" && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDocument(doc, documents[doc].file); }} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">Retry upload</button>}
                        <button type="button" onClick={(event) => removeDocument(event, doc)} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">Remove file</button>
                      </div>
                    </div>
                  )}
                </label>
              ))}
            </SectionCard>

            <SectionCard number="8" title="Account Access">
              <label className={labelClass}>Official Login Email *<input required readOnly type="email" className={`${fieldClass} bg-slate-50`} value={form.loginEmail} /></label>
              <div className="rounded-lg bg-slate-50 p-3 text-sm font-normal text-slate-600">After approval, this email/password account can sign in to CarLoanSaathi. Passwords are handled only by Firebase Authentication.</div>
            </SectionCard>

            <button disabled={loading} className="flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] text-sm font-medium text-white disabled:opacity-70">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit for Super Admin Approval"}
            </button>
          </div>

          <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50"><ShieldCheck className="h-5 w-5 text-[#0d47a1]" /></div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Why dealerships join</h2>
            <div className="mt-4 space-y-2">
              {["Multi-bank finance processing", "Faster loan approvals", "City-wise lead routing", "Dealer dashboard", "Secure document handling", "Real-time tracking", "Finance desk management"].map((benefit) => (
                <p key={benefit} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{benefit}</p>
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-[#0d47a1] p-3 text-sm font-normal leading-6 text-white">
              Lead distribution runs city-wise: customer city to dealership city to active bank city.
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {Object.values(brandLogos).slice(0, 8).map((logo) => <div key={logo} className="flex h-12 items-center justify-center rounded-xl bg-[#f8fbff]"><img src={logo} alt="" className="max-h-7 max-w-14 object-contain" /></div>)}
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}
