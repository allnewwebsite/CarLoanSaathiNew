import { CheckCircle2, ChevronDown, Loader2, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fallbackBanks, fallbackBrands, getFallbackCarsByBrand } from "../data/catalogFallback.js";
import { api } from "../services/api.js";
import { Button } from "./ui/Button.jsx";
import { Toast } from "./ui/Toast.jsx";

const emptyForm = {
  fullName: "",
  mobile: "",
  city: "",
  selectedBrand: "",
  selectedModel: "",
  carPrice: "",
  loanAmount: "",
  employmentType: "",
  preferredBank: "",
};

const steps = [
  { label: "Customer Details", icon: UserRound },
  { label: "Car & Loan", icon: CheckCircle2 },
];

function toOption(item) {
  return {
    label: item.name,
    value: item.slug || item.name,
    item,
  };
}

function SearchableSelect({ label, value, options, placeholder, error, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);
  const selected = options.find((option) => option.value === value || option.label === value);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return options;
    return options.filter((option) => option.label.toLowerCase().includes(search));
  }, [options, query]);

  useEffect(() => {
    const close = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <label ref={wrapperRef} className="relative text-sm font-medium text-slate-700">
      {label}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
          setQuery("");
        }}
        className={`mt-1.5 flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-left text-sm font-normal text-slate-900 outline-none transition focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 ${error ? "border-red-300" : "border-slate-300"} ${disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "hover:border-slate-400"}`}
      >
        <span className={`min-w-0 truncate ${selected ? "" : "text-[#64748b]"}`}>{selected?.label || placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#edf2f7] px-3 py-2">
            <Search className="h-4 w-4 text-[#64748b]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#06152f] outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm font-normal text-slate-500">No match found</p>
            ) : filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setQuery("");
                }}
                className={`block w-full px-3 py-2 text-left text-sm font-normal transition hover:bg-slate-50 ${selected?.value === option.value ? "bg-blue-50 text-[#0d47a1]" : "text-slate-800"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </label>
  );
}

export function ApplyLoanForm({ initialSelection }) {
  const [form, setForm] = useState({ ...emptyForm, ...initialSelection });
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [banks, setBanks] = useState([]);
  const [brandSlug, setBrandSlug] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [step, setStep] = useState(0);

  useEffect(() => {
    const nextForm = { ...emptyForm, ...initialSelection };
    setForm((current) => ({ ...current, ...nextForm }));
  }, [initialSelection?.selectedBrand, initialSelection?.selectedModel, initialSelection?.carPrice, initialSelection?.brandSlug]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/brands").then((response) => response.data?.length ? response.data : fallbackBrands).catch(() => fallbackBrands),
      api.get("/banks").then((response) => response.data?.length ? response.data : fallbackBanks).catch(() => fallbackBanks),
    ]).then(([brandData, bankData]) => {
      if (!active) return;
      setBrands(brandData);
      setBanks(bankData);
      const matched = brandData.find((brand) => brand.name === initialSelection?.selectedBrand || brand.slug === initialSelection?.brandSlug);
      if (matched) setBrandSlug(matched.slug);
    });
    return () => {
      active = false;
    };
  }, [initialSelection?.brandSlug, initialSelection?.selectedBrand]);

  useEffect(() => {
    if (!brandSlug) {
      setModels([]);
      return;
    }

    let active = true;
    api.get(`/cars/${brandSlug}`)
      .then((response) => active && setModels(response.data?.length ? response.data : getFallbackCarsByBrand(brandSlug)))
      .catch(() => active && setModels(getFallbackCarsByBrand(brandSlug)));
    return () => {
      active = false;
    };
  }, [brandSlug]);

  const brandOptions = useMemo(() => brands.map(toOption), [brands]);
  const modelOptions = useMemo(() => models.map(toOption), [models]);
  const bankOptions = useMemo(() => banks.map((bank) => ({ label: bank.name, value: bank.name, item: bank })), [banks]);
  const completion = useMemo(() => Math.round(((step + 1) / steps.length) * 100), [step]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setSuccess("");
  };

  const selectBrand = (option) => {
    setBrandSlug(option.item.slug);
    setForm((current) => ({
      ...current,
      selectedBrand: option.item.name,
      selectedModel: "",
      carPrice: "",
      loanAmount: "",
    }));
    setErrors((current) => ({ ...current, selectedBrand: "", selectedModel: "", carPrice: "" }));
  };

  const selectModel = (option) => {
    const price = option.item.price ? String(option.item.price) : "";
    setForm((current) => ({
      ...current,
      selectedModel: option.item.name,
      carPrice: price,
      loanAmount: price ? String(Math.round(Number(price) * 0.85)) : current.loanAmount,
    }));
    setErrors((current) => ({ ...current, selectedModel: "", carPrice: "", loanAmount: "" }));
  };

  const validate = (targetStep = step) => {
    const nextErrors = {};
    if (targetStep >= 0) {
      if (!form.fullName.trim()) nextErrors.fullName = "Full name is required";
      if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) nextErrors.mobile = "Enter a valid 10-digit mobile number";
      if (!form.city.trim()) nextErrors.city = "City is required";
    }
    if (targetStep >= 1) {
      if (!form.selectedBrand.trim()) nextErrors.selectedBrand = "Selected brand is required";
      if (!form.selectedModel.trim()) nextErrors.selectedModel = "Selected model is required";
      if (!Number(form.carPrice) || Number(form.carPrice) <= 0) nextErrors.carPrice = "Car price is required";
      if (!Number(form.loanAmount) || Number(form.loanAmount) <= 0) nextErrors.loanAmount = "Loan amount is required";
      if (Number(form.loanAmount) > Number(form.carPrice)) nextErrors.loanAmount = "Loan amount cannot exceed car price";
      if (!form.employmentType) nextErrors.employmentType = "Employment type is required";
      if (!form.preferredBank) nextErrors.preferredBank = "Preferred bank is required";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate(1)) return;

    setSubmitting(true);
    setSuccess("");
    try {
      const payload = {
        fullName: form.fullName,
        mobile: form.mobile,
        city: form.city,
        selectedBrand: form.selectedBrand,
        selectedModel: form.selectedModel,
        carPrice: Number(form.carPrice),
        loanAmount: Number(form.loanAmount),
        employmentType: form.employmentType,
        preferredBank: form.preferredBank,
        website: "",
      };
      const response = await api.post("/leads/public", payload);
      setSuccess(`Application submitted successfully. Case ID: ${response.data.caseId || response.data.leadId}`);
      setForm({ ...emptyForm });
      setBrandSlug("");
      setModels([]);
      setStep(0);
      localStorage.removeItem("cls_selected_car");
    } catch (error) {
      const apiErrors = error.response?.data?.errors;
      if (apiErrors?.length) {
        setErrors(Object.fromEntries(apiErrors.map((item) => [item.path, item.message])));
      } else {
        setErrors({ form: error.response?.data?.message || "Unable to submit application. Please try again." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = "field mt-1.5 h-10 rounded-md";
  const labelClass = "text-sm font-medium text-slate-700";

  return (
    <form onSubmit={submit} className="mt-7 w-full overflow-visible rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <Toast message={success} type="success" />
      {errors.form && <div className="mt-4"><Toast message={errors.form} type="error" /></div>}

      <div className="mt-1">
        <div className="grid grid-cols-2 gap-3">
          {steps.map((item, index) => {
            const Icon = item.icon;
            const active = index <= step;
            return (
              <div key={item.label} className="flex min-w-0 items-center gap-2">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${active ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-400"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={`min-w-0 truncate text-xs font-medium sm:text-sm ${active ? "text-slate-900" : "text-slate-400"}`}>{item.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 h-1.5 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-[#244eea] transition-all" style={{ width: `${completion}%` }} />
        </div>
      </div>

      {step === 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={labelClass}>Full Name *
            <input className={fieldClass} value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />
            {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>}
          </label>
          <label className={labelClass}>Mobile Number *
            <input className={fieldClass} inputMode="numeric" maxLength="10" value={form.mobile} onChange={(e) => update("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} />
            {errors.mobile && <p className="mt-1 text-xs text-red-600">{errors.mobile}</p>}
          </label>
          <label className={`${labelClass} md:col-span-2`}>City *
            <input className={fieldClass} value={form.city} onChange={(e) => update("city", e.target.value)} />
            {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city}</p>}
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <SearchableSelect label="Selected Brand *" value={brandSlug} options={brandOptions} placeholder="Search and select brand" error={errors.selectedBrand} onChange={selectBrand} />
          <SearchableSelect label="Selected Model *" value={form.selectedModel} options={modelOptions} placeholder={brandSlug ? "Search and select model" : "Select brand first"} error={errors.selectedModel} onChange={selectModel} disabled={!brandSlug} />
          <label className={labelClass}>Car Price (Rs.) *
            <input className={fieldClass} type="number" value={form.carPrice} onChange={(e) => update("carPrice", e.target.value)} />
            {errors.carPrice && <p className="mt-1 text-xs text-red-600">{errors.carPrice}</p>}
          </label>
          <label className={labelClass}>Loan Amount Required (Rs.) *
            <input className={fieldClass} type="number" value={form.loanAmount} onChange={(e) => update("loanAmount", e.target.value)} />
            {errors.loanAmount && <p className="mt-1 text-xs text-red-600">{errors.loanAmount}</p>}
          </label>
          <label className={labelClass}>Employment Type *
            <select className={fieldClass} value={form.employmentType} onChange={(e) => update("employmentType", e.target.value)}>
              <option value="">Select Employment Type</option>
              <option>Salaried</option>
              <option>Self Employed</option>
              <option>Business Owner</option>
            </select>
            {errors.employmentType && <p className="mt-1 text-xs text-red-600">{errors.employmentType}</p>}
          </label>
          <SearchableSelect label="Preferred Bank *" value={form.preferredBank} options={bankOptions} placeholder="Search and select bank" error={errors.preferredBank} onChange={(option) => update("preferredBank", option.item.name)} />
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="secondary" onClick={() => setStep((current) => Math.max(current - 1, 0))} disabled={step === 0}>Back</Button>
        {step < steps.length - 1 ? (
          <Button type="button" onClick={next}>Continue</Button>
        ) : (
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Apply for Loan"}
          </Button>
        )}
      </div>
    </form>
  );
}
