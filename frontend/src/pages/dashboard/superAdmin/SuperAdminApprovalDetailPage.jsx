import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { api } from "../../../services/api.js";
import { normalizeRows } from "../../../services/apiResponse.js";
import { DataTable, PageTitle } from "./SuperAdminParts.jsx";
import { useAdminEcosystem } from "./superAdmin.hooks.js";
import { bankCapacityDisplay, canActOnApproval, display, finalApprovalStatus } from "./superAdmin.helpers.js";

function responseRows(response) {
  return normalizeRows(response);
}

export function SuperAdminApprovalDetailPage({ type }) {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const [directItem, setDirectItem] = useState(null);
  const [directLoading, setDirectLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const navigate = useNavigate();
  const item = type === "banks"
    ? directItem || data.pendingBankApprovals.find((entry) => entry.id === id)
    : directItem || data.pendingDealershipApprovals.find((entry) => entry.id === id);

  useEffect(() => {
    let active = true;
    const loadDirectItem = async () => {
      setDirectLoading(true);
      try {
        const endpoint = type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships";
        const [pendingResponse, approvedResponse] = await Promise.all([
          api.get(endpoint, { params: { status: "pending", search: id, limit: 25 } }),
          api.get(endpoint, { params: { status: "approved", search: id, limit: 25 } }),
        ]);
        const rows = [...responseRows(pendingResponse), ...responseRows(approvedResponse)];
        const match = rows.find((entry) => entry.id === id || entry.ifsc === id || entry.ifscCode === id || entry.loginEmail === id);
        if (active) setDirectItem(match || null);
      } catch {
        if (active) setDirectItem(null);
      } finally {
        if (active) setDirectLoading(false);
      }
    };
    if (!item) loadDirectItem();
    else setDirectLoading(false);
    return () => { active = false; };
  }, [id, item, type]);

  const approve = async () => {
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/approve`);
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to approve application");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/reject`, { reason });
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to reject application");
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    const suspensionReason = reason.trim() || "Suspended by Super Admin";
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/suspend`, { reason: suspensionReason });
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to suspend application");
    } finally {
      setBusy(false);
    }
  };

  if ((data.loading || directLoading) && !item) return <DetailPageSkeleton />;
  if (!item) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Application not found.</section>;

  const canAct = canActOnApproval(item);
  const sections = type === "banks"
    ? [
      ["Bank Details", [["Bank Name", item.bankName || item.companyName], ["Email", item.email], ["Mobile", item.mobile]]],
      ["Branch Details", [["Bank Branch Location", item.bankBranchLocation || item.branchLocation || item.city], ["State", item.state || "Haryana"], ["IFSC", item.ifsc]]],
      ["Branch Manager Details", [["Manager", item.managerName || item.contactPerson], ["Email", item.officialEmail || item.email], ["Mobile", item.mobile]]],
      ["Executive List", (item.executives || []).map((exec, index) => [`Executive ${index + 1}`, exec.name || exec.fullName || exec.email])],
      ["Branch Capacity", [["Monthly Loan Capacity", bankCapacityDisplay(item)], ["Number Of Executives", item.executiveCount]]],
    ]
    : [
      ["Dealership Information", [["Dealership", item.dealershipName], ["Brand", item.dealershipBrand], ["GSTIN", item.gstinNumber || item.dealership?.gstinNumber], ["City", item.city], ["Selected Plan", item.selectedPlan || item.dealership?.selectedPlan || "TRIAL"], ["Address", item.dealership?.address]]],
      ["Business Capacity", [["Monthly Sales", item.dealership?.monthlyCarSalesCapacity]]],
    ];

  return (
    <section className="space-y-5">
      <PageTitle mode={type === "banks" ? "bank approval details" : "dealership approval details"} />
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map(([title, rows]) => (
          <section key={title} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <div className="mt-3 grid gap-2">
              {(rows.length ? rows : [["No records", "-"]]).map(([label, value]) => <div key={label} className="grid grid-cols-[150px_1fr] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900">{display(value)}</span></div>)}
            </div>
          </section>
        ))}
      </div>
      <DataTable title="Uploaded Verification Files" headers={["Document", "File", "Status", "Actions"]} rows={((item.documents || []).length ? item.documents : type === "banks" ? [
        { type: "Authorization Letter" },
        { type: "Branch Address Proof" },
        { type: "Manager ID" },
      ] : [
        { type: "GST Certificate" },
        { type: "Dealership License" },
        { type: "Office Exterior" },
        { type: "Office Interior" },
      ]).map((doc) => {
        const url = doc.fileUrl || doc.url;
        return { key: doc.fileName || doc.type || doc.documentType, cells: [display(doc.label || doc.type || doc.documentType), display(doc.fileName), display(doc.status || "Submitted"), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview / Download</a> : "Stored in application"] };
      })} loading={false} />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Approval Action</h2>
        {actionError ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</div> : null}
        <textarea className="mt-3 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Rejection reason required only when rejecting" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy || !canAct} onClick={approve} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
          <button disabled={busy || !canAct || !reason.trim()} onClick={reject} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Reject</button>
          <button disabled={busy || finalApprovalStatus(item)} onClick={suspend} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 disabled:opacity-50">Suspend</button>
        </div>
      </section>
    </section>
  );
}
