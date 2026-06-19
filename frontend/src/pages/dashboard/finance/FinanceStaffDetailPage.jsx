import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmActionModal } from "../../../components/ConfirmActionModal.jsx";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { api, findCachedGetItem, getCachedGetData, invalidateGetCache } from "../../../services/api.js";
import { dateTime, display } from "../financeDesk.helpers.js";

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

export function FinanceStaffDetailPage() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const cachedEmployee = getCachedGetData(`/dealer/staff/${encodeURIComponent(employeeId)}`)
    || findCachedGetItem("/dealer/staff", (item) => item.id === employeeId || item.email === employeeId || item.employeeId === employeeId);
  const [employee, setEmployee] = useState(() => cachedEmployee);
  const [loading, setLoading] = useState(() => !cachedEmployee);
  const [error, setError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/dealer/staff/${encodeURIComponent(employeeId)}`);
      setEmployee(response.data || null);
    } catch (err) {
      setEmployee((current) => current || null);
      setError(err.response?.data?.message || "Unable to load employee profile");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { loadEmployee(); }, [loadEmployee]);

  const removeEmployee = async () => {
    if (!employee) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/dealer/staff/${encodeURIComponent(employee.email || employee.id)}`);
      invalidateGetCache({ prefix: "/dealer/staff", purge: true });
      navigate("/finance/manage-staff");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove employee");
      setDeleting(false);
    }
  };

  if (loading && !employee) return <DetailPageSkeleton />;
  if (!employee) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">{error || "Employee not found."}</section>;

  const profile = [
    ["Employee Full Name", employee.fullName],
    ["Role", employee.roleLabel],
    ["Official Email", employee.email],
    ["Mobile Number", employee.mobile],
    ["Employee ID", employee.employeeId],
    ["Branch / Location", employee.branch || employee.city],
    ["Status", employee.status],
    ["Created Date", dateTime(employee.createdAt)],
    ["Created By", employee.createdBy],
    ["Last Login Date", dateTime(employee.lastLoginAt)],
    ["Assigned Dealership", employee.assignedDealership],
    ["Unique Employee ID", employee.uniqueEmployeeId],
    ["Authentication Account ID", employee.authAccountId],
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle title="Employee Details" subtitle="Verified staff profile and authentication mapping." />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate("/finance/manage-staff")} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Back</button>
          {employee.protected ? null : <button type="button" onClick={() => setConfirmDeleteOpen(true)} className="h-9 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700">Remove</button>}
        </div>
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{display(employee.roleLabel)}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{display(employee.fullName)}</h1>
          <p className="text-sm text-slate-500">{display(employee.email)}</p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profile.map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
              <p className="mt-1 break-words text-sm font-medium text-slate-900">{display(value)}</p>
            </div>
          ))}
        </div>
      </section>
      <ConfirmActionModal
        open={confirmDeleteOpen}
        eyebrow="Permanent Delete"
        title="Remove Employee"
        message="This will permanently delete the staff profile, login access, active sessions, cached staff projection, and related staff notifications. Existing case history remains saved."
        detail={`${display(employee.fullName)} - ${display(employee.email)}`}
        confirmLabel="Delete Permanently"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteOpen(false);
        }}
        onConfirm={removeEmployee}
      />
    </section>
  );
}
