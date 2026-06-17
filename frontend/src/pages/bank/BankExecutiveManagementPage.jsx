import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DashboardDetailsModal } from "../../components/PortalUserMenu.jsx";
import { api } from "../../services/api.js";
import { BankManagerTable as Table, PageTitle } from "./BankManagerPanelParts.jsx";
import { useExecutives } from "./bankManager.hooks.js";
import { cleanEmail, cleanText, digits10, display, executiveDeleteId, validEmail } from "./bankManager.helpers.js";

export function ManageExecutivePage() {
  const navigate = useNavigate();
  const { rows, loading, load } = useExecutives();
  const [form, setForm] = useState({ name: "", mobile: "", email: "" });
  const [errors, setErrors] = useState({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [activeLeadBlock, setActiveLeadBlock] = useState(null);
  const [toast, setToast] = useState({ message: "", type: "success" });
  const [viewExecutive, setViewExecutive] = useState(null);

  const closeDeleteModal = useCallback(() => {
    setPendingDelete(null);
    setActiveLeadBlock(null);
  }, []);

  const openDeleteModal = useCallback((executive) => {
    setError("");
    setMessage("");
    setToast({ message: "", type: "success" });
    setActiveLeadBlock(null);
    setPendingDelete(executive);
  }, []);

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = window.setTimeout(() => setToast({ message: "", type: "success" }), 3500);
    return () => window.clearTimeout(timer);
  }, [toast.message]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmittedOnce(true);
    setMessage("");
    setError("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const response = await api.post("/bank/executives", nextForm);
      setForm({ name: "", mobile: "", email: "" });
      setSubmittedOnce(false);
      setMessage("Executive added successfully.");
      setCredentials({
        name: response.data?.name || response.data?.fullName || nextForm.name,
        email: response.data?.email || nextForm.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/executive/login`,
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to add executive");
    } finally {
      setBusy(false);
    }
  };

  const deleteExecutive = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError("");
    setMessage("");
    setActiveLeadBlock(null);
    try {
      await api.delete(`/bank/executives/${encodeURIComponent(executiveDeleteId(pendingDelete))}`);
      closeDeleteModal();
      setToast({ message: "Executive deleted successfully.", type: "success" });
      await load();
    } catch (err) {
      if (err.response?.data?.code === "ACTIVE_EXECUTIVE_LEADS") {
        setActiveLeadBlock({
          executive: pendingDelete,
          activeLeadCount: err.response.data.activeLeadCount || 0,
          transferUrl: err.response.data.transferUrl || `/bank-manager/executives/${encodeURIComponent(executiveDeleteId(pendingDelete))}/cases`,
        });
      } else {
        setToast({ message: err.response?.data?.message || "Unable to delete executive", type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const tableRows = useMemo(() => rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      display(executive.status),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setViewExecutive(executive)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button type="button" onClick={() => openDeleteModal(executive)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Delete</button>
      </div>,
    ],
  })), [openDeleteModal, rows]);

  return (
    <section className="space-y-4">
      <PageTitle title="Manage Executive" />
      <DashboardDetailsModal
        open={Boolean(viewExecutive)}
        onClose={() => setViewExecutive(null)}
        title="Executive Profile"
        subtitle="Loan Executive account information"
        rows={[
          ["Name", display(viewExecutive?.name || viewExecutive?.fullName)],
          ["Email", display(viewExecutive?.email || viewExecutive?.officialEmail)],
          ["Mobile", viewExecutive?.mobile ? `+91 ${viewExecutive.mobile}` : "-"],
          ["Role", "Loan Executive"],
          ["Bank", display(viewExecutive?.bankName)],
          ["Branch", display(viewExecutive?.bankBranchLocation || viewExecutive?.branch || viewExecutive?.branchCity)],
          ["IFSC", display(viewExecutive?.bankIfsc || viewExecutive?.ifsc || viewExecutive?.ifscCode)],
          ["Status", display(viewExecutive?.status)],
        ]}
      />
      {toast.message ? (
        <div className={`fixed right-4 top-20 z-[60] rounded-lg border px-4 py-3 text-sm font-semibold shadow-lg ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {toast.message}
        </div>
      ) : null}
      {credentials ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Executive Created Successfully</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{credentials.name}</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p><span className="font-semibold">Portal Login:</span> {credentials.portalLogin}</p>
                <p><span className="font-semibold">Email:</span> {credentials.email}</p>
                <p><span className="font-semibold">Temporary Password:</span> {credentials.temporaryPassword}</p>
              </div>
              <p className="mt-3 text-sm font-medium text-emerald-800">Please ask executive to change password after first login.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Portal Login: ${credentials.portalLogin}\nEmail: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Credentials</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(credentials.portalLogin)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Portal URL</button>
              <button type="button" onClick={() => setCredentials(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      ) : null}
      <DeleteExecutiveModal
        executive={pendingDelete}
        activeLeadBlock={activeLeadBlock}
        busy={busy}
        onCancel={closeDeleteModal}
        onConfirm={deleteExecutive}
        onTransfer={() => {
          if (activeLeadBlock?.transferUrl) navigate(activeLeadBlock.transferUrl);
        }}
      />
      <form noValidate onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Executive Name<input aria-invalid={Boolean(submittedOnce && errors.name)} className={`mt-2 h-10 w-full rounded-md border px-3 outline-none focus:border-[#0d47a1] ${submittedOnce && errors.name ? "border-red-300" : "border-slate-200"}`} value={form.name} onChange={(event) => update("name", event.target.value.replace(/[<>]/g, ""))} /><span className={`validation-slot ${submittedOnce && errors.name ? "" : "validation-slot-empty"}`}>{submittedOnce && errors.name ? errors.name : "No validation issue"}</span></label>
          <label className="text-sm font-medium text-slate-700">
            Mobile Number
            <div className={`mt-2 flex h-10 overflow-hidden rounded-md border ${submittedOnce && errors.mobile ? "border-red-300" : "border-slate-200"} focus-within:border-[#0d47a1]`}>
              <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
              <input aria-invalid={Boolean(submittedOnce && errors.mobile)} className="h-full w-full px-3 outline-none" value={form.mobile} maxLength={10} inputMode="numeric" onChange={(event) => update("mobile", digits10(event.target.value))} />
            </div>
            <span className={`validation-slot ${submittedOnce && errors.mobile ? "" : "validation-slot-empty"}`}>{submittedOnce && errors.mobile ? errors.mobile : "No validation issue"}</span>
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">Official Email<input aria-invalid={Boolean(submittedOnce && errors.email)} type="email" className={`mt-2 h-10 w-full rounded-md border px-3 outline-none focus:border-[#0d47a1] ${submittedOnce && errors.email ? "border-red-300" : "border-slate-200"}`} value={form.email} onChange={(event) => update("email", event.target.value.trim().toLowerCase())} /><span className={`validation-slot ${submittedOnce && errors.email ? "" : "validation-slot-empty"}`}>{submittedOnce && errors.email ? errors.email : "No validation issue"}</span></label>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <div className="form-action-row">
          <button disabled={busy} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Add Executive"}
          </button>
        </div>
      </form>
      <Table title="Executive List" headers={["Executive Name", "Mobile Number", "Official Email", "Status", "Actions"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function DeleteExecutiveModal({ executive, activeLeadBlock, busy, onCancel, onConfirm, onTransfer }) {
  useEffect(() => {
    if (!executive) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, executive, onCancel]);

  if (!executive) return null;

  const executiveName = executive.name || executive.fullName || executive.email || executive.officialEmail || "Executive";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="delete-executive-title" className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="delete-executive-title" className="text-lg font-semibold text-slate-950">Delete Executive</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">You are about to permanently delete this executive.</p>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Executive Name</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{executiveName}</p>
        </div>
        <p className="mt-4 text-sm font-semibold text-red-700">This action cannot be undone.</p>
        <div className="mt-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Before deletion ensure:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>No active assigned cases</li>
            <li>No pending transfers</li>
            <li>No active reassignment operations</li>
          </ul>
        </div>
        {activeLeadBlock ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold">Executive has active cases.</p>
            <p>{activeLeadBlock.activeLeadCount} active case{activeLeadBlock.activeLeadCount === 1 ? "" : "s"} must be transferred before deletion.</p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Cancel</button>
          {activeLeadBlock ? (
            <button type="button" onClick={onTransfer} className="rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white">Transfer Leads</button>
          ) : (
            <button type="button" disabled={busy} onClick={onConfirm} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Deleting..." : "Delete Executive"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
