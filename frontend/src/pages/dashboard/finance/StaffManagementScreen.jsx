import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmActionModal } from "../../../components/ConfirmActionModal.jsx";
import { ButtonSpinner } from "../../../components/ui/Loading.jsx";
import { mutationUrlMatches, useBackgroundRefresh } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData, invalidateGetCache } from "../../../services/api.js";
import { cleanEmail, cleanText, dateValue, digits10, display, validEmail } from "../financeDesk.helpers.js";
import { Field, FinanceTable as Table, MobileInput, SectionTitle } from "./FinanceDeskPanelParts.jsx";

const staffMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/staff"]);

const emptyStaff = { fullName: "", email: "", mobile: "", employeeId: "", role: "", branch: "", city: "" };

export function StaffManagementScreen() {
  const navigate = useNavigate();
  const cachedStaff = getCachedGetData("/dealer/staff");
  const [rows, setRows] = useState(() => cachedStaff || []);
  const [loading, setLoading] = useState(() => !cachedStaff);
  const [form, setForm] = useState(emptyStaff);
  const [errors, setErrors] = useState({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingEmail, setDeletingEmail] = useState("");

  const loadStaff = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/staff");
      setRows(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff({ silent: Boolean(cachedStaff) }); }, [loadStaff]);
  useBackgroundRefresh({ onRefresh: loadStaff, refreshKey: "finance-staff", mutationFilter: staffMutationFilter });

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
    setSubmittedOnce(true);
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
      const response = await api.post("/dealer/staff", nextForm, { timeout: 60000 });
      setForm(emptyStaff);
      setSubmittedOnce(false);
      setMessage("Employee created successfully.");
      setCredentials({
        name: response.data?.fullName || nextForm.fullName,
        role: response.data?.roleLabel || "GM",
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

  const removeStaff = async () => {
    if (!pendingDelete) return;
    const deleteEmail = pendingDelete.email || pendingDelete.id;
    setMessage("");
    setError("");
    setDeletingEmail(deleteEmail);
    try {
      await api.delete(`/dealer/staff/${encodeURIComponent(deleteEmail)}`);
      invalidateGetCache({ prefix: "/dealer/staff", purge: true });
      setRows((current) => current.filter((item) => (item.email || item.id) !== deleteEmail));
      setPendingDelete(null);
      setMessage("Employee permanently removed.");
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove employee");
    } finally {
      setDeletingEmail("");
    }
  };

  const tableRows = rows.map((staff) => ({
    key: staff.id,
    cells: [
      display(staff.fullName),
      display(staff.roleLabel),
      display(staff.email),
      display(staff.mobile),
      display(staff.employeeId),
      display(staff.branch || staff.city),
      display(staff.status),
      dateValue(staff.createdAt),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate(`/finance/staff/${encodeURIComponent(staff.email || staff.id)}`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        {staff.protected ? null : <button type="button" onClick={() => setPendingDelete(staff)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Remove</button>}
      </div>,
    ],
  }));

  return (
    <section className="space-y-4">
      <SectionTitle title="Add GM" subtitle="Create dealership General Manager accounts with temporary password security." />
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
      <form noValidate onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Full Name" error={submittedOnce ? errors.fullName : ""}><input aria-invalid={Boolean(submittedOnce && errors.fullName)} className="field mt-1.5 h-10 rounded-md" value={form.fullName} onChange={(event) => update("fullName", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Official Email" error={submittedOnce ? errors.email : ""}><input aria-invalid={Boolean(submittedOnce && errors.email)} type="email" className="field mt-1.5 h-10 rounded-md" value={form.email} onChange={(event) => update("email", cleanEmail(event.target.value))} /></Field>
          <Field label="Mobile Number" error={submittedOnce ? errors.mobile : ""}><MobileInput value={form.mobile} error={submittedOnce ? errors.mobile : ""} onChange={(value) => update("mobile", value)} /></Field>
          <Field label="Employee ID" error={submittedOnce ? errors.employeeId : ""}><input aria-invalid={Boolean(submittedOnce && errors.employeeId)} className="field mt-1.5 h-10 rounded-md" value={form.employeeId} onChange={(event) => update("employeeId", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Role" error={submittedOnce ? errors.role : ""}><select required aria-invalid={Boolean(submittedOnce && errors.role)} className="field mt-1.5 h-10 rounded-md" value={form.role} onChange={(event) => update("role", event.target.value)}><option value="">Select Role</option><option value="gm">GM</option></select></Field>
          <Field label="Branch / Location"><input className="field mt-1.5 h-10 rounded-md" value={form.branch} onChange={(event) => update("branch", event.target.value.replace(/[<>]/g, ""))} /></Field>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <button disabled={busy} className="mt-4 inline-flex min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? <ButtonSpinner /> : "Create Employee"}</button>
      </form>
      <Table headers={["Employee Name", "Role", "Official Email", "Mobile Number", "Employee ID", "Branch", "Status", "Created Date", "Actions"]} rows={tableRows} loading={loading} />
      <ConfirmActionModal
        open={Boolean(pendingDelete)}
        eyebrow="Permanent Delete"
        title="Remove Employee"
        message="This will permanently delete the staff profile, login access, active sessions, cached staff projection, and related staff notifications. Existing case history remains saved."
        detail={pendingDelete ? `${display(pendingDelete.fullName)} - ${display(pendingDelete.email)}` : ""}
        confirmLabel="Delete Permanently"
        loading={Boolean(deletingEmail)}
        onCancel={() => {
          if (!deletingEmail) setPendingDelete(null);
        }}
        onConfirm={removeStaff}
      />
    </section>
  );
}
