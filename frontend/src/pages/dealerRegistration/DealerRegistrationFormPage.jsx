import { CheckCircle2, FileCheck2, Landmark, Loader2, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Toast } from "../../components/ui/Toast.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { brandLogos } from "../../data/catalogFallback.js";
import { bankStates, dealershipBrands, locationsForState } from "../../data/bankLocationMaster.js";
import { api } from "../../services/api.js";
import { CONVERSION_EVENTS, trackConversionEvent } from "../../services/conversionAnalytics.js";
import { SectionCard, SelectBox, StandardSelect } from "./DealerRegistrationParts.jsx";
import {
  allowedDocumentTypes,
  documentConfig,
  documentFields,
  initialForm,
  maxDocumentSize,
  salesCapacity,
} from "./dealerRegistration.constants.js";
import { buildDealerRegistrationPayload, validateDealerRegistrationForm } from "./dealerRegistration.helpers.js";

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
  }));
  const [documents, setDocuments] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const dealerUid = firebaseUser?.uid || registrationSession.uid || registrationSession.registrationId || registrationSession.email || "";
  const dealerEmail = firebaseUser?.email || registrationSession.email || "";
  const locationOptions = useMemo(() => locationsForState(form.state), [form.state]);

  const hasVerifiedEmail = Boolean(
      dealerEmail
    && (
      firebaseUser?.emailVerified === true
      || registrationSession.emailVerified === true
      || isAuthenticated
    )
  );

  useEffect(() => {
    if (dealerEmail) {
      setForm((current) => ({
        ...current,
        loginEmail: current.loginEmail || dealerEmail,
      }));
    }
  }, [dealerEmail]);

  const update = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "state") next.city = "";
      return next;
    });
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
    const uid = dealerUid;
    if (!uid) {
      setError("Create an email/password account before uploading dealership documents.");
      return;
    }
    setError("");
    const safeName = `${Date.now()}-${file.name}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `dealer-registration/${uid}/${config.folder}/${safeName}`;

    setDocuments((current) => ({
      ...current,
      [name]: { file, progress: 0, status: "uploading", storagePath, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "" },
    }));

    try {
      const { uploadStorageFile } = await import("../../services/firebaseUpload.js");
      const { fileUrl } = await uploadStorageFile({
        file,
        storagePath,
        contentType: file.type,
        onProgress: (progress) => setDocuments((current) => ({ ...current, [name]: { ...current[name], progress, status: "uploading" } })),
      });
      setDocuments((current) => ({
        ...current,
        [name]: { ...current[name], progress: 100, status: "uploaded", fileUrl, storagePath, documentType: config.type },
      }));
    } catch (uploadError) {
      setDocuments((current) => ({ ...current, [name]: { ...current[name], status: "error", error: uploadError.message } }));
      setError(uploadError.message || "Document upload failed. Please retry.");
    }
  };

  const removeDocument = async (event, name) => {
    event.preventDefault();
    event.stopPropagation();
    const document = documents[name];
    if (document?.storagePath) {
      try {
        const { deleteStoragePath } = await import("../../services/firebaseUpload.js");
        await deleteStoragePath(document.storagePath);
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

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const validation = validateDealerRegistrationForm({ form, bankStates, locationOptions, hasVerifiedEmail, dealerEmail });
    if (validation) {
      setError(validation);
      return;
    }

    setLoading(true);
    try {
      const payload = buildDealerRegistrationPayload({ form, registrationSession, dealerEmail, dealerUid, documents });
      const response = await api.post("/dealer/register", payload);
      setSuccess(`${response.data.message} Request ID: ${response.data.onboardingRequestId}`);
      trackConversionEvent(CONVERSION_EVENTS.REGISTRATION_COMPLETED, "dealer_registration_form");
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
              {["25+ Partner Banks", "Location-based Lead Distribution", "Real-time Dashboard", "Faster Approvals"].map((item) => (
                <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">{item}</div>
              ))}
            </div>
          </div>
          <div className="relative min-h-56 overflow-hidden rounded-lg bg-slate-50 p-5">
            <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-lg bg-white"><Landmark className="h-5 w-5 text-[#0d47a1]" /></div>
            <div className="mt-14 rounded-lg bg-white p-4">
              <Sparkles className="h-6 w-6 text-[#0d47a1]" />
              <p className="mt-3 text-lg font-semibold text-slate-900">Finance desk onboarding</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Verified dealership identity, location mapping, approval readiness, and document status.</p>
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
              <label className={labelClass}>GSTIN Number *<input required maxLength={15} className={fieldClass} value={form.gstinNumber} onChange={(e) => update("gstinNumber", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} placeholder="06ABCDE1234F1Z5" /></label>
              <label className={labelClass}>
                Official Dealership Mobile Number *
                <div className="mt-2 flex h-10 overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-[#0d47a1]">
                  <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
                  <input required maxLength={10} inputMode="numeric" className="h-full w-full px-3 outline-none" value={form.officialDealershipMobile} onChange={(e) => update("officialDealershipMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} />
                </div>
              </label>
            </SectionCard>

            <SectionCard number="2" title="Dealership Location">
              <StandardSelect label="State *" value={form.state} options={bankStates} onChange={(value) => update("state", value)} placeholder="Select state" />
              <SelectBox label="Location *" value={form.city} options={locationOptions} onChange={(value) => update("city", value)} placeholder="Search supported location" />
              <label className={labelClass}>Pincode *<input required className={fieldClass} value={form.pincode} onChange={(e) => update("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
              <label className={labelClass}>Landmark<input className={fieldClass} value={form.landmark} onChange={(e) => update("landmark", e.target.value)} /></label>
              <label className={`${labelClass} md:col-span-2`}>Full Dealership Address *<textarea required className="field mt-2 min-h-28 rounded-2xl py-3" value={form.address} onChange={(e) => update("address", e.target.value)} /></label>
            </SectionCard>

            <SectionCard number="3" title="Business & Loan Capacity">
              <StandardSelect label="Monthly Car Sales Capacity *" value={form.monthlyCarSalesCapacity} options={salesCapacity} onChange={(value) => update("monthlyCarSalesCapacity", value)} placeholder="Select monthly capacity" />
            </SectionCard>
            <SectionCard number="4" title="Document Uploads">
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

            <SectionCard number="5" title="Account Access">
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
              {["Multi-bank finance processing", "Faster loan approvals", "Location-wise lead routing", "Dealer dashboard", "Secure document handling", "Real-time tracking", "Finance desk management"].map((benefit) => (
                <p key={benefit} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{benefit}</p>
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-[#0d47a1] p-3 text-sm font-normal leading-6 text-white">
              Lead distribution runs location-wise: customer location to dealership location to active bank branch location.
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {Object.values(brandLogos).slice(0, 8).map((logo) => <div key={logo} className="flex h-12 items-center justify-center rounded-xl bg-[#f8fbff]"><img src={logo} alt="" loading="lazy" decoding="async" className="max-h-7 max-w-14 object-contain" /></div>)}
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}
