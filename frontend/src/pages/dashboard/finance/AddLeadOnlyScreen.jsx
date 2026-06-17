import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ButtonSpinner } from "../../../components/ui/Loading.jsx";
import { LEAD_STATUSES } from "../../../constants/status.js";
import { api } from "../../../services/api.js";
import { cleanText, numericAmount } from "../financeDesk.helpers.js";
import { Field, MobileInput, SectionTitle } from "./FinanceDeskPanelParts.jsx";
import { useFinanceManagers, useSalespersons } from "./financeStaff.hooks.js";

const emptyLead = {
  fullName: "",
  mobile: "",
  city: "",
  carPrice: "",
  loanAmount: "",
  salespersonId: "",
  financeManagerId: "",
  branchId: "",
};

function bankKey(branch) {
  return branch.ifscCode || branch.id || "";
}

function branchLabel(branch) {
  return `${branch.bankName || "Bank"} - ${branch.branchName || "Branch"}${branch.ifscCode ? ` (${branch.ifscCode})` : ""}`;
}

export function AddLeadOnlyScreen() {
  const navigate = useNavigate();
  const { salespersons } = useSalespersons();
  const { financeManagers } = useFinanceManagers();
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [form, setForm] = useState(emptyLead);
  const [errors, setErrors] = useState({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadTieUps = async () => {
      setBranchesLoading(true);
      setBranchesError("");
      try {
        const response = await api.get("/dealer/bank-tieups");
        const currentTieUps = Array.isArray(response.data?.branchTieUps)
          ? response.data.branchTieUps
          : Array.isArray(response.data?.currentTieUps)
            ? response.data.currentTieUps
            : [];
        setBranches(currentTieUps);
      } catch (error) {
        setBranches([]);
        setBranchesError("Unable to load tied-up banks. Please try again.");
      } finally {
        setBranchesLoading(false);
      }
    };
    loadTieUps();
  }, []);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setMessage("");
  };

  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.fullName)) nextErrors.fullName = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.city)) nextErrors.city = "Field required";
    if (!nextForm.branchId) nextErrors.branchId = "Select tied-up bank branch";
    if (!Number(nextForm.carPrice) || Number(nextForm.carPrice) < 0) nextErrors.carPrice = "Field required";
    if (!Number(nextForm.loanAmount) || Number(nextForm.loanAmount) < 0) nextErrors.loanAmount = "Field required";
    if (Number(nextForm.loanAmount) > Number(nextForm.carPrice)) nextErrors.loanAmount = "Required Loan Amount cannot exceed Car On-Road Price";
    if (!nextForm.salespersonId) nextErrors.salespersonId = salespersons.length ? "Field required" : "Add salesperson first";
    if (!nextForm.financeManagerId) nextErrors.financeManagerId = financeManagers.length ? "Field required" : "Add Finance Manager first";
    return nextErrors;
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmittedOnce(true);
    const nextForm = {
      ...form,
      fullName: cleanText(form.fullName),
      city: cleanText(form.city),
      carPrice: numericAmount(form.carPrice),
      loanAmount: numericAmount(form.loanAmount),
    };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return setMessage("Fix highlighted fields.");
    setSubmitting(true);
    try {
      const response = await api.post("/dealer/leads", {
        ...nextForm,
        status: LEAD_STATUSES.NEW,
        carPrice: Number(nextForm.carPrice),
        loanAmount: Number(nextForm.loanAmount),
        branchId: nextForm.branchId,
        bankBranchId: nextForm.branchId,
        ifscCode: nextForm.branchId,
      });
      navigate(`/finance/leads/${response.data.leadId}/documents`, { state: { created: true } });
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Add Lead" subtitle="Create a dealership case and route it to one tied-up bank branch." />
      <form noValidate onSubmit={submit} className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Customer and routing details</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Select the dealership team owner and one active bank branch before submitting the case.</p>
        </div>
        <div className="p-5">
          {message ? <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
          {branchesError ? <p className="mb-4 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{branchesError}</p> : null}
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-3">
            <Field label="Customer Name *" error={submittedOnce ? errors.fullName : ""}><input required aria-invalid={Boolean(submittedOnce && errors.fullName)} className="field mt-1.5" value={form.fullName} onChange={(event) => update("fullName", event.target.value.replace(/[<>]/g, ""))} /></Field>
            <Field label="Mobile Number *" error={submittedOnce ? errors.mobile : ""}><MobileInput required value={form.mobile} error={submittedOnce ? errors.mobile : ""} onChange={(value) => update("mobile", value)} /></Field>
            <Field label="Customer City *" error={submittedOnce ? errors.city : ""}><input required aria-invalid={Boolean(submittedOnce && errors.city)} className="field mt-1.5" value={form.city} onChange={(event) => update("city", event.target.value.replace(/[<>]/g, ""))} /></Field>
            <Field label="Tied-up Bank Branch *" error={submittedOnce ? errors.branchId : ""}>
              <select required aria-invalid={Boolean(submittedOnce && errors.branchId)} disabled={branchesLoading} className="field mt-1.5" value={form.branchId} onChange={(event) => update("branchId", event.target.value)}>
                <option value="">Select branch</option>
                {branches.map((branch) => <option key={bankKey(branch)} value={bankKey(branch)}>{branchLabel(branch)}</option>)}
              </select>
            </Field>
            <Field label="Car On-Road Price *" error={submittedOnce ? errors.carPrice : ""}><input required aria-invalid={Boolean(submittedOnce && errors.carPrice)} className="field mt-1.5" inputMode="numeric" value={form.carPrice} onChange={(event) => update("carPrice", numericAmount(event.target.value))} /></Field>
            <Field label="Required Loan Amount *" error={submittedOnce ? errors.loanAmount : ""}><input required aria-invalid={Boolean(submittedOnce && errors.loanAmount)} className="field mt-1.5" inputMode="numeric" value={form.loanAmount} onChange={(event) => update("loanAmount", numericAmount(event.target.value))} /></Field>
            <Field label="Select Salesperson *" error={submittedOnce ? errors.salespersonId : ""}><select required aria-invalid={Boolean(submittedOnce && errors.salespersonId)} className="field mt-1.5" value={form.salespersonId} onChange={(event) => update("salespersonId", event.target.value)}><option value="">{salespersons.length ? "Select salesperson" : "No salesperson found"}</option>{salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}</select></Field>
            <Field label="Finance Manager *" error={submittedOnce ? errors.financeManagerId : ""}>
              <select required aria-invalid={Boolean(submittedOnce && errors.financeManagerId)} className="field mt-1.5" value={form.financeManagerId} onChange={(event) => update("financeManagerId", event.target.value)}>
                <option value="">{financeManagers.length ? "Select Finance Manager" : "No Finance Manager found"}</option>
                {financeManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} - {manager.employeeId}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-5 text-slate-500">Documents are optional and can be uploaded on the next screen.</p>
            <button disabled={submitting} className="inline-flex h-10 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white shadow-sm transition hover:bg-[#0b3f8c] disabled:opacity-60">{submitting ? <ButtonSpinner /> : "Submit Lead"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
