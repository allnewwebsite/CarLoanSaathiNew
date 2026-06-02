import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Search, UploadCloud, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api } from "../../services/api.js";

const pageSize = 10;
const documentTypes = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const statusTabs = [
  { label: "Disbursed", value: "Disbursed" },
  { label: "Rejected With Reason", value: "Rejected" },
  { label: "Pending Documents", value: "Pending Documents" },
  { label: "Bank Process", value: "Bank Processing" },
];

const emptyLead = {
  fullName: "",
  mobile: "",
  city: "",
  carPrice: "",
  loanAmount: "",
  salespersonId: "",
  branchId: "",
};

const emptySalesperson = { name: "", mobile: "", jobId: "", email: "" };
const emptyStaff = { fullName: "", email: "", mobile: "", employeeId: "", role: "finance-head", branch: "", city: "" };
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function display(value) {
  return value || "-";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function numericAmount(value) {
  const clean = String(value || "").replace(/[^\d]/g, "");
  return clean ? String(Number(clean)) : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateValue(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function bankDisplay(lead) {
  return lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner || lead.preferredBank || "";
}

function financeStatus(lead) {
  const status = normalizeStatus(lead?.status);
  if (status === LEAD_STATUSES.NEW) return "New Lead";
  if (status === LEAD_STATUSES.DISBURSED) return "Disbursed";
  if (status === LEAD_STATUSES.REJECTED) return lead?.rejectionReason ? "Rejected With Reason" : "Rejected";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(status)) return "Pending Documents";
  return "Bank Process";
}

function StatusBadge({ lead }) {
  const label = financeStatus(lead);
  const tone = {
    Disbursed: "bg-slate-800 text-white",
    "New Lead": "bg-slate-100 text-slate-700",
    "Rejected With Reason": "bg-rose-50 text-rose-700",
    Rejected: "bg-rose-50 text-rose-700",
    "Pending Documents": "bg-amber-50 text-amber-700",
    "Bank Process": "bg-blue-50 text-[#0d47a1]",
  }[label] || "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function Table({ headers, rows, loading, page, total, onPage }) {
  return <OperationalTable headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} />;
}

function useSalespersons({ includeInactive = false } = {}) {
  const [salespersons, setSalespersons] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadSalespersons = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/dealer/salespersons", { params: { includeInactive } });
      setSalespersons(response.data || []);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadSalespersons(); }, [loadSalespersons]);
  return { salespersons, loading, loadSalespersons };
}

function useDealerLeads(filters = {}) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const loadLeads = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const response = await api.get("/dealer/leads", { params: { page: 1, limit: pageSize, ...filters, ...params } });
      const payload = Array.isArray(response.data) ? { data: response.data, total: response.data.length } : response.data;
      setLeads(payload.data || []);
      setTotal(payload.total || 0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters.status, filters.salespersonId, filters.search]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);
  useRoleLeadRealtime({ onRefresh: loadLeads, pageSize });
  return { leads, total, loading, loadLeads };
}

function DocumentsButton({ lead }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">View Documents</button>;
}

function leadRows(leads, mode = "total") {
  return leads.map((lead) => {
    const base = [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
    ];
    if (mode === "status") {
      const cells = [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        display(bankDisplay(lead)),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" lead={lead} />,
        dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      ];
      if (normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED) {
        cells.splice(6, 0, display(lead.rejectionReason), display(lead.updatedByExecutiveName || lead.rejectedBy || lead.assignedExecutiveName));
      }
      cells.push(<DocumentsButton key="docs" lead={lead} />);
      return { key: lead.id, cells };
    }
    if (mode === "cases") {
      return {
        key: lead.id,
        cells: [
          ...base,
          display(bankDisplay(lead)),
          moneyValue(lead.carPrice || lead.carOnRoadPrice),
          moneyValue(lead.loanAmount || lead.requiredLoanAmount),
          display(lead.bankPartner || lead.assignedBankName),
          display(lead.assignedExecutiveName),
          <StatusBadge key="status" lead={lead} />,
          dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
          <DocumentsButton key="docs" lead={lead} />,
        ],
      };
    }
    return {
      key: lead.id,
      cells: [
        ...base,
        display(bankDisplay(lead)),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        dateValue(lead.generatedAt || lead.createdAt),
        <StatusBadge key="status" lead={lead} />,
        display(lead.assignedExecutiveName),
        <DocumentsButton key="docs" lead={lead} />,
      ],
    };
  });
}

export function FinanceDeskPanel({ mode = "total" }) {
  if (mode === "add") return <AddLeadScreen />;
  if (mode === "staff") return <StaffManagementScreen />;
  if (mode === "salespersons") return <SalespersonManagementScreen />;
  if (mode === "active-salespersons") return <ActiveSalespersonsScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "status") return <StatusScreen />;
  return <TotalLeadsScreen />;
}

function StaffManagementScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyStaff);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/dealer/staff");
      setRows(response.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.fullName)) nextErrors.fullName = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.employeeId)) nextErrors.employeeId = "Field required";
    if (!nextForm.role) nextErrors.role = "Field required";
    return nextErrors;
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const nextForm = {
      fullName: cleanText(form.fullName),
      email: cleanEmail(form.email),
      mobile: digits10(form.mobile),
      employeeId: cleanText(form.employeeId),
      role: form.role,
      branch: cleanText(form.branch),
      city: cleanText(form.city),
    };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const response = await api.post("/dealer/staff", nextForm);
      setForm(emptyStaff);
      setMessage("Employee created successfully.");
      setCredentials({
        name: response.data?.fullName || nextForm.fullName,
        role: response.data?.roleLabel || (nextForm.role === "finance-head" ? "Finance Head" : "GM / SM"),
        email: response.data?.email || nextForm.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/dealer/login`,
      });
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create employee");
    } finally {
      setBusy(false);
    }
  };

  const lifecycle = async (staff, action) => {
    const label = staff.fullName || staff.email;
    let payload = { action };
    if (action === "transfer") {
      const branch = window.prompt("Enter new branch/location", staff.branch || staff.city || "");
      if (!branch) return;
      payload = { action, branch, city: branch };
    } else if (action !== "activate" && !window.confirm(`${action === "remove" ? "Remove" : action === "suspend" ? "Suspend" : "Disable"} ${label}?`)) return;
    try {
      await api.post(`/dealer/staff/${staff.id}/lifecycle`, payload);
      setMessage(`Employee ${action} completed.`);
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.message || `Unable to ${action} employee`);
    }
  };

  const resetPassword = async (staff) => {
    if (!window.confirm(`Reset password for ${staff.fullName || staff.email}? Existing sessions will be revoked.`)) return;
    try {
      const response = await api.post(`/dealer/staff/${staff.id}/reset-password`);
      setCredentials({
        name: response.data?.employee?.fullName || staff.fullName,
        role: staff.roleLabel,
        email: staff.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/dealer/login`,
      });
      setMessage("Temporary password generated.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to reset password");
    }
  };

  const tableRows = rows.map((staff) => ({
    key: staff.id,
    cells: [
      display(staff.fullName),
      display(staff.roleLabel),
      display(staff.mobile),
      display(staff.email),
      display(staff.employeeId),
      display(staff.branch || staff.city),
      display(staff.status),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.alert(`${staff.fullName}\n${staff.email}\n${staff.mobile}\n${staff.roleLabel}`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button type="button" onClick={() => lifecycle(staff, "suspend")} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">Suspend</button>
        <button type="button" onClick={() => lifecycle(staff, "activate")} className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">Activate</button>
        <button type="button" onClick={() => resetPassword(staff)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">Reset Password</button>
        <button type="button" onClick={() => lifecycle(staff, "transfer")} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">Transfer Branch</button>
        <button type="button" onClick={() => lifecycle(staff, "remove")} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Remove</button>
      </div>,
    ],
  }));

  return (
    <section className="space-y-4">
      <SectionTitle title="Manage Staff" subtitle="Create dealership Finance Head, GM, and SM accounts with temporary password security." />
      {credentials ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Employee Created Successfully</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{credentials.name}</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p><span className="font-semibold">Role:</span> {credentials.role}</p>
                <p><span className="font-semibold">Portal Login:</span> {credentials.portalLogin}</p>
                <p><span className="font-semibold">Official Email:</span> {credentials.email}</p>
                <p><span className="font-semibold">Temporary Password:</span> {credentials.temporaryPassword}</p>
              </div>
              <p className="mt-3 text-sm font-medium text-emerald-800">Please ask employee to change password after first login.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Portal Login: ${credentials.portalLogin}\nRole: ${credentials.role}\nEmail: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Credentials</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(credentials.portalLogin)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Portal URL</button>
              <button type="button" onClick={() => setCredentials(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Full Name" error={errors.fullName}><input aria-invalid={Boolean(errors.fullName)} className="field mt-1.5 h-10 rounded-md" value={form.fullName} onBlur={() => setErrors(validate(form))} onChange={(event) => update("fullName", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Official Email" error={errors.email}><input aria-invalid={Boolean(errors.email)} type="email" className="field mt-1.5 h-10 rounded-md" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(event) => update("email", cleanEmail(event.target.value))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5 h-10 rounded-md" value={form.mobile} maxLength={10} inputMode="numeric" onBlur={() => setErrors(validate(form))} onChange={(event) => update("mobile", digits10(event.target.value))} /></Field>
          <Field label="Employee ID" error={errors.employeeId}><input aria-invalid={Boolean(errors.employeeId)} className="field mt-1.5 h-10 rounded-md" value={form.employeeId} onBlur={() => setErrors(validate(form))} onChange={(event) => update("employeeId", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Role" error={errors.role}><select aria-invalid={Boolean(errors.role)} className="field mt-1.5 h-10 rounded-md" value={form.role} onBlur={() => setErrors(validate(form))} onChange={(event) => update("role", event.target.value)}><option value="finance-head">Finance Head</option><option value="gm">GM</option><option value="sm">SM</option></select></Field>
          <Field label="Branch / Location"><input className="field mt-1.5 h-10 rounded-md" value={form.branch} onChange={(event) => update("branch", event.target.value.replace(/[<>]/g, ""))} /></Field>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <button disabled={busy} className="mt-4 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Create Employee</button>
      </form>
      <Table headers={["Employee Name", "Role", "Mobile Number", "Official Email", "Employee ID", "Branch / Location", "Status", "Actions"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function TotalLeadsScreen() {
  const [page, setPage] = useState(1);
  const { leads, total, loading, loadLeads } = useDealerLeads();
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All cases submitted by this dealership finance desk." />
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Selected Bank", "Loan Amount", "Generated Date", "Current Status", "Assigned Executive", "Documents"]} rows={leadRows(leads)} loading={loading} page={page} total={total} onPage={pageTo} />
    </div>
  );
}

function AddLeadScreen() {
  const navigate = useNavigate();
  const { salespersons } = useSalespersons();
  const [branches, setBranches] = useState([]);
  const [availableBranches, setAvailableBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [tieUpSearch, setTieUpSearch] = useState("");
  const [tieUpCity, setTieUpCity] = useState("");
  const [tieUpState, setTieUpState] = useState("");
  const [tieUpMessage, setTieUpMessage] = useState("");
  const [tieUpError, setTieUpError] = useState("");
  const [tieUpLoading, setTieUpLoading] = useState(true);
  const [tieUpSaving, setTieUpSaving] = useState(false);
  const [form, setForm] = useState(emptyLead);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadBankData = async () => {
      setTieUpLoading(true);
      try {
        const dealerBranchesResponse = await api.get("/dealer/bank-tieups");
        const allBranches = Array.isArray(dealerBranchesResponse.data?.availableBranches)
          ? dealerBranchesResponse.data.availableBranches
          : Array.isArray(dealerBranchesResponse.data?.availableBanks)
            ? dealerBranchesResponse.data.availableBanks
            : [];
        setAvailableBranches(allBranches.filter((branch) => branch.active !== false));
        const currentTieUps = Array.isArray(dealerBranchesResponse.data?.branchTieUps)
          ? dealerBranchesResponse.data.branchTieUps
          : Array.isArray(dealerBranchesResponse.data?.currentTieUps)
            ? dealerBranchesResponse.data.currentTieUps
            : [];
        setBranches(currentTieUps);
        setSelectedBranchIds(currentTieUps.map((branch) => branch.ifscCode || branch.id).filter(Boolean));
      } catch (error) {
        setAvailableBranches([]);
        setBranches([]);
        setTieUpError("Unable to load available branches");
      } finally {
        setTieUpLoading(false);
      }
    };
    loadBankData();
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
    if (!nextForm.salespersonId) nextErrors.salespersonId = "Field required";
    return nextErrors;
  };
  const validateField = (field) => {
    const nextErrors = validate(form);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] || "" }));
  };
  const submit = async (event) => {
    event.preventDefault();
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

  const toggleBranch = (branchId) => {
    setTieUpMessage("");
    setTieUpError("");
    setSelectedBranchIds((current) => {
      if (current.includes(branchId)) {
        return current.filter((id) => id !== branchId);
      }
      return [...current, branchId];
    });
  };

  const saveTieUps = async () => {
    setTieUpMessage("");
    setTieUpError("");
    setTieUpSaving(true);
    try {
      await api.patch("/dealer/bank-tieups", { bankTieUps: selectedBranchIds });
      const response = await api.get("/dealer/bank-tieups");
      const updatedBranches = Array.isArray(response.data?.branchTieUps)
        ? response.data.branchTieUps
        : Array.isArray(response.data?.currentTieUps)
          ? response.data.currentTieUps
          : [];
      setBranches(updatedBranches);
      setSelectedBranchIds(updatedBranches.map((branch) => branch.ifscCode || branch.id).filter(Boolean));
      setTieUpMessage("Bank branch tie-ups updated successfully.");
    } catch (error) {
      setTieUpError(error.response?.data?.message || "Unable to save bank tie-ups");
    } finally {
      setTieUpSaving(false);
    }
  };

  const tieUpCities = useMemo(() => [...new Set(availableBranches.map((branch) => branch.city).filter(Boolean))].sort(), [availableBranches]);
  const tieUpStates = useMemo(() => [...new Set(availableBranches.map((branch) => branch.state).filter(Boolean))].sort(), [availableBranches]);
  const filteredBranches = useMemo(() => {
    const search = cleanText(tieUpSearch).toLowerCase();
    return availableBranches.filter((branch) => {
      const matchesSearch = !search || [
        branch.bankName,
        branch.branchName,
        branch.ifscCode,
        branch.city,
        branch.state,
      ].some((value) => String(value || "").toLowerCase().includes(search));
      const matchesCity = !tieUpCity || branch.city === tieUpCity;
      const matchesState = !tieUpState || branch.state === tieUpState;
      return matchesSearch && matchesCity && matchesState;
    });
  }, [availableBranches, tieUpCity, tieUpSearch, tieUpState]);

  return (
    <div className="space-y-4">
      <SectionTitle title="Add Lead" subtitle="Create a dealership case and select a tied-up bank branch for manual lender routing." />
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manage Bank Branch Tie-ups</h2>
            <p className="mt-2 text-sm text-slate-600">Select only approved bank branches that this dealership is tied up with. The selected branches are available when creating new leads.</p>
          </div>
          <button type="button" disabled={tieUpSaving || tieUpLoading} onClick={saveTieUps} className="h-11 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">
            {tieUpSaving ? "Saving..." : "Save Tie-ups"}
          </button>
        </div>
        {tieUpError ? <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{tieUpError}</p> : null}
        {tieUpMessage ? <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tieUpMessage}</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="field flex h-10 items-center gap-2 rounded-md bg-white px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={tieUpSearch} onChange={(event) => setTieUpSearch(event.target.value)} placeholder="Search bank, branch, IFSC" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <select value={tieUpCity} onChange={(event) => setTieUpCity(event.target.value)} className="field h-10 rounded-md bg-white">
            <option value="">All cities</option>
            {tieUpCities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <select value={tieUpState} onChange={(event) => setTieUpState(event.target.value)} className="field h-10 rounded-md bg-white">
            <option value="">All states</option>
            {tieUpStates.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
        </div>
        <div className="mt-4 grid gap-3">
          {tieUpLoading ? (
            <p className="text-sm text-slate-500">Loading branch options...</p>
          ) : filteredBranches.length ? (
            filteredBranches.map((branch) => {
              const branchKey = branch.ifscCode || branch.id;
              return (
              <label key={branchKey} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-[#0d47a1]">
                <input type="checkbox" checked={selectedBranchIds.includes(branchKey)} onChange={() => toggleBranch(branchKey)} className="h-4 w-4 rounded border-slate-300 text-[#0d47a1] focus:ring-[#0d47a1]" />
                <span>{branch.bankName} — {branch.branchName}{branch.ifscCode ? ` (${branch.ifscCode})` : ""}</span>
              </label>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">No approved bank branches match this search.</p>
          )}
        </div>
      </section>
      <form onSubmit={submit} className="card p-5">
        {message ? <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer Name" error={errors.fullName}><input aria-invalid={Boolean(errors.fullName)} className="field mt-1.5" value={form.fullName} onBlur={() => validateField("fullName")} onChange={(e) => update("fullName", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => validateField("mobile")} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Customer City" error={errors.city}><input aria-invalid={Boolean(errors.city)} className="field mt-1.5" value={form.city} onBlur={() => validateField("city")} onChange={(e) => update("city", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Tied-up Bank Branch" error={errors.branchId}>
            <select aria-invalid={Boolean(errors.branchId)} className="field mt-1.5" value={form.branchId} onBlur={() => validateField("branchId")} onChange={(e) => update("branchId", e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.bankName} — {branch.branchName}{branch.ifscCode ? ` (${branch.ifscCode})` : ""}</option>
              ))}
            </select>
            {branches.length === 0 ? <p className="mt-2 text-sm text-rose-600">No tied-up bank branches found. Configure bank tie-ups in dealer profile first.</p> : null}
          </Field>
          <Field label="Car On-Road Price" error={errors.carPrice}><input aria-invalid={Boolean(errors.carPrice)} className="field mt-1.5" inputMode="numeric" value={form.carPrice} onBlur={() => validateField("carPrice")} onChange={(e) => update("carPrice", numericAmount(e.target.value))} /></Field>
          <Field label="Required Loan Amount" error={errors.loanAmount}><input aria-invalid={Boolean(errors.loanAmount)} className="field mt-1.5" inputMode="numeric" value={form.loanAmount} onBlur={() => validateField("loanAmount")} onChange={(e) => update("loanAmount", numericAmount(e.target.value))} /></Field>
          <Field label="Select Salesperson" error={errors.salespersonId}><select aria-invalid={Boolean(errors.salespersonId)} className="field mt-1.5" value={form.salespersonId} onBlur={() => validateField("salespersonId")} onChange={(e) => update("salespersonId", e.target.value)}><option value="">Select salesperson</option>{salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}</select></Field>
          <div className="flex items-end">
            <button disabled={submitting} className="h-10 rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-60">{submitting ? "Creating..." : "Submit Lead"}</button>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-500">Documents are optional and can be uploaded on the next screen.</p>
      </form>
    </div>
  );
}

function SalespersonManagementScreen() {
  const { salespersons, loading, loadSalespersons } = useSalespersons({ includeInactive: true });
  const [form, setForm] = useState(emptySalesperson);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.jobId)) nextErrors.jobId = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };
  const add = async (event) => {
    event.preventDefault();
    setMessage("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), jobId: cleanText(form.jobId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await api.post("/dealer/salespersons", nextForm);
      setForm(emptySalesperson);
      await loadSalespersons();
      setMessage("Salesperson added");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to add salesperson");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (person) => {
    await api.delete(`/dealer/salespersons/${person.id}`);
    await loadSalespersons();
  };
  const rows = salespersons.map((person) => ({
    key: person.id,
    cells: [
      person.name,
      person.mobile,
      person.jobId,
      person.email,
      person.active ? "Active" : "Inactive",
      person.active ? <button key="remove" onClick={() => remove(person)} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700">Remove</button> : "-",
    ],
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form onSubmit={add} className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Add Salesperson</h2>
        {message ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="mt-4 grid gap-3">
          <Field label="Salesperson Name" error={errors.name}><input aria-invalid={Boolean(errors.name)} className="field mt-1.5" value={form.name} onBlur={() => setErrors(validate(form))} onChange={(e) => update("name", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => setErrors(validate(form))} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Job ID" error={errors.jobId}><input aria-invalid={Boolean(errors.jobId)} className="field mt-1.5" value={form.jobId} onBlur={() => setErrors(validate(form))} onChange={(e) => update("jobId", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mail ID" error={errors.email}><input aria-invalid={Boolean(errors.email)} className="field mt-1.5" type="email" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(e) => update("email", e.target.value.trim().toLowerCase())} /></Field>
          <button disabled={saving} className="h-10 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? "Saving..." : "Add Salesperson"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Add / Remove Salesperson" subtitle="Soft remove keeps existing case history intact." />
        <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID", "Status", "Action"]} rows={rows} loading={loading} />
      </div>
    </div>
  );
}

function ActiveSalespersonsScreen() {
  const { salespersons, loading } = useSalespersons();
  const rows = salespersons.map((person) => ({ key: person.id, cells: [person.name, person.mobile, person.jobId, person.email] }));
  return (
    <div className="space-y-4">
      <SectionTitle title="Active Salespersons" subtitle="Only active salespersons attached to this dealership." />
      <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID"]} rows={rows} loading={loading} />
    </div>
  );
}

function AllCasesScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const salespersonId = params.get("salespersonId") || "";
  const search = params.get("search") || "";
  const { salespersons } = useSalespersons();
  const filters = useMemo(() => ({ salespersonId, search }), [salespersonId, search]);
  const { leads, total, loading, loadLeads } = useDealerLeads(filters);
  const updateFilter = (next) => {
    const merged = { salespersonId, search, page: "1", ...next };
    Object.keys(merged).forEach((key) => !merged[key] && delete merged[key]);
    setPage(1);
    setParams(merged);
    loadLeads({ ...merged, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="All Cases" subtitle="Main dealership monitoring page with server-side salesperson filtering." />
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_240px]">
        <div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400" /><input className="h-9 flex-1 outline-none" placeholder="Search customer or mobile" defaultValue={search} onChange={(e) => updateFilter({ search: e.target.value })} /></div>
        <select className="field" value={salespersonId} onChange={(e) => updateFilter({ salespersonId: e.target.value })}>
          <option value="">Filter By Salesperson</option>
          {salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}
        </select>
      </div>
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Selected Bank", "Car On-Road Price", "Required Loan Amount", "Assigned Bank", "Assigned Executive", "Current Status", "Status Updated Date", "Documents"]} rows={leadRows(leads, "cases")} loading={loading} page={page} total={total} onPage={pageTo} />
    </div>
  );
}

function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const status = params.get("status") || "Bank Processing";
  const { leads, total, loading, loadLeads } = useDealerLeads({ status });
  const choose = (value) => {
    setPage(1);
    setParams({ status: value, page: "1" });
    loadLeads({ status: value, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage, status });
  };
  const rejected = status === "Rejected";
  return (
    <div className="space-y-4">
      <SectionTitle title="Status" subtitle="Status lists update from Loan Executive changes." />
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}
      </div>
      <Table headers={rejected ? ["Case ID", "Customer Name", "Mobile Number", "Selected Bank", "Loan Amount", "Current Status", "Rejection Reason", "Executive Name", "Last Updated", "Documents"] : ["Case ID", "Customer Name", "Mobile Number", "Selected Bank", "Loan Amount", "Current Status", "Last Updated", "Documents"]} rows={leadRows(leads, "status")} loading={loading} page={page} total={total} onPage={pageTo} />
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Field({ label, children, error }) {
  return <label className="text-sm font-medium text-slate-700">{label}{children}{error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}</label>;
}

export function FinanceLeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/dealer/leads/${leadId}`);
      setLead(response.data);
    } catch {
      setLead(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead });

  if (loading) return <section className="card p-5 text-sm text-slate-500">Loading lead...</section>;
  if (!lead) return <section className="card p-5 text-sm text-slate-500">Lead not found.</section>;

  return (
    <section className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{lead.fullName || "Lead Details"}</h2>
            <p className="mt-1 text-sm text-slate-500">{caseId(lead)} · {lead.mobile || "-"}</p>
          </div>
          <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white">View Documents</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[["Case ID", caseId(lead)], ["Customer", lead.fullName], ["City", lead.city], ["Selected Bank", bankDisplay(lead)], ["Loan Amount", moneyValue(lead.loanAmount)], ["Salesperson", lead.assignedSalesperson], ["Executive", lead.assignedExecutiveName], ["Status", financeStatus(lead)]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase text-slate-500">{label}</p>
              <p className="mt-1 font-medium text-slate-900">{value || "-"}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinanceLeadDocumentsPage() {
  const { leadId } = useParams();
  const [lead, setLead] = useState(null);
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState({});
  const [progress, setProgress] = useState({});
  const [message, setMessage] = useState("");

  const loadDocs = useCallback(() => {
    api.get(`/documents/lead/${leadId}`).then((response) => setDocs(response.data || [])).catch(() => setDocs([]));
  }, [leadId]);

  useEffect(() => { loadDocs(); }, [loadDocs]);
  useEffect(() => {
    let active = true;
    api.get(`/dealer/leads/${leadId}`).then((response) => { if (active) setLead(response.data); }).catch(() => {});
    return () => { active = false; };
  }, [leadId]);
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadDocs });

  const upload = async (type) => {
    const file = files[type];
    if (!file) return;
    const form = new FormData();
    form.append("document", file);
    form.append("leadId", leadId);
    form.append("type", type);
    setProgress((current) => ({ ...current, [type]: 1 }));
    try {
      await api.post("/documents/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const percent = event.total ? Math.round((event.loaded * 100) / event.total) : 50;
          setProgress((current) => ({ ...current, [type]: percent }));
        },
      });
      setMessage(`${type} uploaded`);
      setFiles((current) => ({ ...current, [type]: null }));
      setProgress((current) => ({ ...current, [type]: 100 }));
      loadDocs();
    } catch {
      setProgress((current) => ({ ...current, [type]: -1 }));
      setMessage(`${type} upload failed. Retry upload.`);
    }
  };

  const uploaded = (type) => docs.find((doc) => String(doc.type || "").toLowerCase() === type.toLowerCase());
  return (
    <section className="space-y-5">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Customer Documents</h2>
        <p className="mt-1 text-sm text-slate-500">Case ID: {caseId(lead || { id: leadId })}</p>
        {message ? <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-[#0d47a1]">{message}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {documentTypes.map((type) => {
          const doc = uploaded(type);
          const file = files[type];
          const percent = progress[type] || 0;
          return (
            <div key={type} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-medium text-slate-900">{type}</h3><p className="mt-1 text-xs text-slate-500">{doc ? "Uploaded" : "Optional"}</p></div>
                <FileText className="h-5 w-5 text-slate-400" />
              </div>
              <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-500">
                <UploadCloud className="mb-2 h-5 w-5" />
                {file?.name || doc?.file || "Choose file"}
                <input type="file" className="hidden" accept=".pdf,image/png,image/jpeg" onChange={(e) => setFiles((current) => ({ ...current, [type]: e.target.files?.[0] || null }))} />
              </label>
              {percent > 0 ? <div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${percent < 0 ? "bg-red-500" : "bg-[#0d47a1]"}`} style={{ width: `${Math.max(percent, 8)}%` }} /></div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => upload(type)} disabled={!file} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">{doc ? "Replace" : percent < 0 ? "Retry Upload" : "Upload"}</button>
                {doc?.url ? <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-xs">Preview</a> : null}
                <button onClick={() => setFiles((current) => ({ ...current, [type]: null }))} className="h-9 rounded-md border border-slate-200 px-3 text-xs">Remove File</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
