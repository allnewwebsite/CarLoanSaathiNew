import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Toast } from "../../components/ui/Toast.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { brandLogos } from "../../data/catalogFallback.js";
import { bankStates, dealershipBrands, locationsForState } from "../../data/bankLocationMaster.js";
import { api } from "../../services/api.js";
import { CONVERSION_EVENTS, trackConversionEvent } from "../../services/conversionAnalytics.js";
import {
  DealerRegistrationEmailRequiredView,
  DealerRegistrationHero,
  DealerRegistrationSidebar,
  DealerRegistrationSubmittedView,
} from "./DealerRegistrationFormViews.jsx";
import {
  AccountAccessSection,
  BusinessCapacitySection,
  DealerDocumentUploadsSection,
  DealershipInformationSection,
  DealershipLocationSection,
} from "./DealerRegistrationFormSections.jsx";
import {
  allowedDocumentTypes,
  documentConfig,
  initialForm,
  maxDocumentSize,
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
    return <DealerRegistrationEmailRequiredView />;
  }

  if (success) {
    return <DealerRegistrationSubmittedView />;
  }

  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <DealerRegistrationHero registrationEmail={registrationSession.email} />

        <form onSubmit={submit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Toast message={success} type="success" />
            <Toast message={error} type="error" />

            <DealershipInformationSection form={form} dealershipBrands={dealershipBrands} update={update} />
            <DealershipLocationSection bankStates={bankStates} form={form} locationOptions={locationOptions} update={update} />
            <BusinessCapacitySection form={form} update={update} />
            <DealerDocumentUploadsSection documents={documents} removeDocument={removeDocument} setDocument={setDocument} />
            <AccountAccessSection form={form} />

            <button disabled={loading} className="flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] text-sm font-medium text-white disabled:opacity-70">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit for Super Admin Approval"}
            </button>
          </div>

          <DealerRegistrationSidebar brandLogos={brandLogos} CheckIcon={CheckCircle2} />
        </form>
      </div>
    </main>
  );
}
