import { useState } from "react";
import { ConfirmActionModal } from "../../../components/ConfirmActionModal.jsx";
import { ButtonSpinner } from "../../../components/ui/Loading.jsx";
import { api, invalidateGetCache } from "../../../services/api.js";
import { cleanEmail, cleanText, digits10, validEmail } from "../financeDesk.helpers.js";
import { Field, FinanceTable as Table, MobileInput, SectionTitle } from "./FinanceDeskPanelParts.jsx";
import { useFinanceManagers, useSalespersons } from "./financeStaff.hooks.js";

const emptySalesperson = { name: "", mobile: "", jobId: "", email: "" };
const emptyFinanceManager = { name: "", mobile: "", employeeId: "", email: "" };

export function SalespersonManagementScreen() {
  const { salespersons, loading, loadSalespersons } = useSalespersons({ includeInactive: true });
  const [form, setForm] = useState(emptySalesperson);
  const [errors, setErrors] = useState({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState("");
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
    setSubmittedOnce(true);
    setMessage("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), jobId: cleanText(form.jobId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await api.post("/dealer/salespersons", nextForm);
      setForm(emptySalesperson);
      setSubmittedOnce(false);
      await loadSalespersons();
      setMessage("Salesperson added");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to add salesperson");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    setMessage("");
    try {
      await api.delete(`/dealer/salespersons/${pendingDelete.id}`);
      invalidateGetCache({ prefix: "/dealer/salespersons", purge: true });
      setPendingDelete(null);
      await loadSalespersons();
      setMessage("Salesperson deleted");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to delete salesperson");
    } finally {
      setDeletingId("");
    }
  };
  const rows = salespersons.map((person) => ({
    key: person.id,
    cells: [
      person.name,
      person.mobile,
      person.jobId,
      person.email,
      <button key="delete" onClick={() => setPendingDelete(person)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Delete</button>,
    ],
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form noValidate onSubmit={add} className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Add Salesperson</h2>
        {message ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="mt-4 grid gap-3">
          <Field label="Salesperson Name" error={submittedOnce ? errors.name : ""}><input aria-invalid={Boolean(submittedOnce && errors.name)} className="field mt-1.5" value={form.name} onChange={(event) => update("name", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={submittedOnce ? errors.mobile : ""}><MobileInput value={form.mobile} error={submittedOnce ? errors.mobile : ""} onChange={(value) => update("mobile", value)} /></Field>
          <Field label="Job ID" error={submittedOnce ? errors.jobId : ""}><input aria-invalid={Boolean(submittedOnce && errors.jobId)} className="field mt-1.5" value={form.jobId} onChange={(event) => update("jobId", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mail ID" error={submittedOnce ? errors.email : ""}><input aria-invalid={Boolean(submittedOnce && errors.email)} className="field mt-1.5" type="email" value={form.email} onChange={(event) => update("email", event.target.value.trim().toLowerCase())} /></Field>
          <button disabled={saving} className="inline-flex h-10 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? <ButtonSpinner /> : "Add Salesperson"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Add / Remove Salesperson" subtitle="Delete removes the salesperson master record. Existing cases keep copied history." />
        <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID", "Action"]} rows={rows} loading={loading} />
      </div>
      <ConfirmActionModal
        open={Boolean(pendingDelete)}
        eyebrow="Permanent Delete"
        title="Delete Salesperson"
        message="This will permanently delete the salesperson master record. Existing case history keeps the copied salesperson details."
        detail={pendingDelete ? `${pendingDelete.name || "Salesperson"} - ${pendingDelete.email || pendingDelete.mobile || pendingDelete.id}` : ""}
        confirmLabel="Delete Permanently"
        loading={Boolean(deletingId)}
        onCancel={() => {
          if (!deletingId) setPendingDelete(null);
        }}
        onConfirm={remove}
      />
    </div>
  );
}

export function FinanceManagerManagementScreen() {
  const { financeManagers, loading, loadFinanceManagers } = useFinanceManagers({ includeInactive: true });
  const [form, setForm] = useState(emptyFinanceManager);
  const [errors, setErrors] = useState({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.employeeId)) nextErrors.employeeId = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };
  const add = async (event) => {
    event.preventDefault();
    setSubmittedOnce(true);
    setMessage("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), employeeId: cleanText(form.employeeId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await api.post("/dealer/finance-managers", nextForm);
      setForm(emptyFinanceManager);
      setSubmittedOnce(false);
      await loadFinanceManagers();
      setMessage("Finance Manager added");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to add Finance Manager");
    } finally {
      setSaving(false);
    }
  };
  const deleteManager = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    setMessage("");
    try {
      await api.delete(`/dealer/finance-managers/${pendingDelete.id}`);
      invalidateGetCache({ prefix: "/dealer/finance-managers", purge: true });
      setPendingDelete(null);
      await loadFinanceManagers();
      setMessage("Finance Manager deleted");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to delete Finance Manager");
    } finally {
      setDeletingId("");
    }
  };
  const rows = financeManagers.map((manager) => ({
    key: manager.id,
    cells: [
      manager.name,
      manager.mobile,
      manager.employeeId,
      manager.email,
      <button key="delete" onClick={() => setPendingDelete(manager)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Delete</button>,
    ],
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form noValidate onSubmit={add} className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Add Finance Manager</h2>
        {message ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="mt-4 grid gap-3">
          <Field label="Finance Manager Name" error={submittedOnce ? errors.name : ""}><input aria-invalid={Boolean(submittedOnce && errors.name)} className="field mt-1.5" value={form.name} onChange={(event) => update("name", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={submittedOnce ? errors.mobile : ""}><MobileInput value={form.mobile} error={submittedOnce ? errors.mobile : ""} onChange={(value) => update("mobile", value)} /></Field>
          <Field label="Employee ID" error={submittedOnce ? errors.employeeId : ""}><input aria-invalid={Boolean(submittedOnce && errors.employeeId)} className="field mt-1.5" value={form.employeeId} onChange={(event) => update("employeeId", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Email ID" error={submittedOnce ? errors.email : ""}><input aria-invalid={Boolean(submittedOnce && errors.email)} className="field mt-1.5" type="email" value={form.email} onChange={(event) => update("email", event.target.value.trim().toLowerCase())} /></Field>
          <button disabled={saving} className="inline-flex h-10 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? <ButtonSpinner /> : "Add Finance Manager"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Finance Managers" subtitle="Dealership-scoped ownership master for loan processing responsibility." />
        <Table headers={["Finance Manager Name", "Mobile Number", "Employee ID", "Email ID", "Action"]} rows={rows} loading={loading} />
      </div>
      <ConfirmActionModal
        open={Boolean(pendingDelete)}
        eyebrow="Permanent Delete"
        title="Delete Finance Manager"
        message="This will permanently delete the finance manager master record. Existing case history keeps the copied finance manager details."
        detail={pendingDelete ? `${pendingDelete.name || "Finance Manager"} - ${pendingDelete.email || pendingDelete.mobile || pendingDelete.id}` : ""}
        confirmLabel="Delete Permanently"
        loading={Boolean(deletingId)}
        onCancel={() => {
          if (!deletingId) setPendingDelete(null);
        }}
        onConfirm={deleteManager}
      />
    </div>
  );
}
