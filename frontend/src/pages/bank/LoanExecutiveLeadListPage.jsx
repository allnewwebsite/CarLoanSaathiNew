import { useState } from "react";
import { ChevronRight, FileText, LoaderCircle, MapPin } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { LifecycleArchiveHeader, lifecycleArchiveCopy } from "../../components/LifecycleArchiveHeader.jsx";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { api } from "../../services/api.js";
import {
  DocumentsSheet,
  LeadDetailsModal,
  RejectModal,
  StatusUpdateModal,
} from "./LoanExecutiveLeadModals.jsx";
import { CompactPagination, PageTitle, Table } from "./LoanExecutivePanelParts.jsx";
import { useExecutiveLeads } from "./loanExecutive.hooks.js";
import { useBankDealershipOptions } from "./dealershipFilter.js";
import {
  caseId,
  dateTime,
  display,
  executiveStatusLabel,
  generatedAt,
  moneyValue,
  statusFilters,
} from "./loanExecutive.helpers.js";

function identityValues(values = []) {
  return new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

export function canAcceptAssignedLead(lead = {}, user = {}) {
  const status = normalizeStatus(lead.status);
  const deadline = lead.acceptanceDueAt ? new Date(lead.acceptanceDueAt).getTime() : Number.POSITIVE_INFINITY;
  const ownerValues = identityValues([lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.executiveMobile]);
  const userValues = identityValues([user.uid, user.id, user.executiveId, user.email, user.officialEmail, user.mobile, user.phone]);
  const belongsToUser = [...ownerValues].some((value) => userValues.has(value));
  return String(lead.assignmentStatus || "").toLowerCase() === "pending"
    && String(lead.ownershipStatus || "").toUpperCase() !== "ACCEPTED"
    && lead.accepted !== true
    && lead.isDeadCase !== true
    && belongsToUser
    && status === LEAD_STATUSES.NEW
    && (!Number.isFinite(deadline) || deadline > Date.now());
}

function LeadCard({ lead, user, accepting, onAccept, onUpdate, onDocs, onDetails }) {
  const awaitingAcceptance = canAcceptAssignedLead(lead, user);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#0d47a1]">{caseId(lead)}</p>
          <h2 className="mt-1 truncate text-base font-semibold text-slate-950">{display(lead.fullName || lead.customerName)}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" /> {display(lead.city || lead.dealershipCity)}</p>
        </div>
        <StatusBadge lead={lead} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-500">Loan Amount</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{moneyValue(lead.loanAmount || lead.requiredLoanAmount)}</p>
        </div>
        <p className="max-w-[45%] truncate text-right text-xs font-medium text-slate-600">{executiveStatusLabel(lead)}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" disabled={accepting} onClick={awaitingAcceptance ? onAccept : onUpdate} className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-[#0d47a1] px-2 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-70">{accepting ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Accepting</> : awaitingAcceptance ? "Accept" : "Update"}</button>
        <button type="button" onClick={onDocs} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"><FileText className="h-3.5 w-3.5" /> Docs</button>
        <button type="button" onClick={onDetails} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700">Details <ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
      {awaitingAcceptance ? <p className="mt-2 text-right text-[11px] font-medium text-amber-700">Accept within the 5-hour assignment SLA</p> : null}
    </article>
  );
}

export function LoanExecutiveLeadListPage({ mode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [acceptingLeadId, setAcceptingLeadId] = useState("");
  const archived = mode === "rejected" || mode === "disbursed";
  const statusMode = mode === "status" || archived;
  const archiveKind = archived ? mode : "";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const requestedStatus = archived ? (mode === "disbursed" ? LEAD_STATUSES.DISBURSED : LEAD_STATUSES.REJECTED) : mode === "status" ? params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0] : "";
  const status = archived ? normalizeStatus(requestedStatus) : statusMode && CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : mode === "status" ? CURRENT_WORKFLOW_STATUS_OPTIONS[0] : "";
  const archiveCopy = archived ? lifecycleArchiveCopy(archiveKind) : null;
  const dealershipFilter = archived ? params.get("dealershipId") || "" : "";
  const { dealerships, loading: dealershipsLoading } = useBankDealershipOptions(archived);
  const { rows, total, hasMore, loading, page, onPage, load, refreshLatest, applyLeadPatch } = useExecutiveLeads({ search: debouncedSearch, status, archiveTerminal: archived ? "1" : "", dealershipId: dealershipFilter });
  const updateDealership = (value) => setParams({ ...(search ? { search } : {}), ...(value ? { dealershipId: value } : {}), page: "1" });

  const updateStatus = async (lead, nextStatus) => {
    setStatusError("");
    setStatusNotice("");
    if (nextStatus === "REJECTED_REASON") return setModal({ type: "reject", lead });
    if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(nextStatus)) return setModal({ type: "docs", lead, status: nextStatus });
    if (nextStatus === "STATUS_UPDATE") return setModal({ type: "status", lead });
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, { status: nextStatus });
      load(page);
    } catch (error) {
      setStatusError(error.response?.data?.message || error.message || "Status update failed. Please retry.");
    }
  };

  const acceptLead = async (lead) => {
    if (acceptingLeadId) return;
    setStatusError("");
    setAcceptingLeadId(lead.id);
    try {
      const response = await api.patch(`/bank/leads/${lead.id}/accept`);
      applyLeadPatch(response.data?.lead || { ...lead, assignmentStatus: "accepted", ownershipStatus: "ACCEPTED", accepted: true, acceptanceDueAt: null, slaRunning: false });
      await refreshLatest(page, { silent: true });
    } catch (error) {
      const code = String(error.response?.data?.code || "");
      const message = String(error.response?.data?.message || "").toLowerCase();
      if (code === "LEAD_ALREADY_ACCEPTED" || message.includes("already accepted")) setStatusError("Case already accepted.");
      else if (code === "LEAD_REASSIGNED" || message.includes("reassigned") || message.includes("not assigned")) setStatusError("Case reassigned.");
      else if (error.code === "ERR_NETWORK" || !error.response) setStatusError("Network error. Check your connection and try again.");
      else setStatusError("Case unavailable. Refresh the list and try again.");
    } finally {
      setAcceptingLeadId("");
    }
  };

  const displayedLeads = rows;

  const tableRows = displayedLeads.map((lead) => ({
    key: lead.id,
    cells: statusMode
      ? [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        display(lead.city || lead.dealershipCity),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" lead={lead} />,
        display(lead.financeManagerName || lead.assignedFinanceManager),
        display(lead.financeManagerMobile),
        dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt),
        ...(normalizeStatus(status) === LEAD_STATUSES.REJECTED ? [dateTime(lead.rejectedAt || lead.updatedAt), display(lead.updatedByExecutiveName || lead.rejectedBy)] : []),
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
      ]
      : [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        display(lead.city || lead.dealershipCity),
        moneyValue(lead.onRoadPrice || lead.carOnRoadPrice),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        generatedAt(lead),
        display(lead.financeManagerName || lead.assignedFinanceManager),
        display(lead.financeManagerMobile),
        executiveStatusLabel(lead),
        <div key="status-action" className="flex flex-col items-start gap-1">
          <button disabled={acceptingLeadId === lead.id} onClick={() => canAcceptAssignedLead(lead, user) ? acceptLead(lead) : updateStatus(lead, "STATUS_UPDATE")} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-wait disabled:opacity-70 ${canAcceptAssignedLead(lead, user) ? "bg-[#0d47a1] text-white" : "border border-slate-200 text-slate-700"}`}>{acceptingLeadId === lead.id ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Accepting</> : canAcceptAssignedLead(lead, user) ? "Accept Lead" : "Update"}</button>
          {canAcceptAssignedLead(lead, user) ? <span className="text-[10px] font-medium text-amber-700">5-hour SLA</span> : null}
        </div>,
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>,
      ],
  }));

  const statusHeaders = normalizeStatus(status) === LEAD_STATUSES.REJECTED
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.lastUpdated, "Rejection Timestamp", LEAD_TABLE_LABELS.assignedExecutive, "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.lastUpdated, "Documents"];

  return (
    <section className="space-y-3 lg:space-y-4">
      {archived ? <LifecycleArchiveHeader kind={archiveKind} search={search} onSearch={(value) => { setSearch(value); setParams({ ...(value ? { search: value } : {}), ...(dealershipFilter ? { dealershipId: dealershipFilter } : {}), page: "1" }); }} dealerships={dealerships} dealershipsLoading={dealershipsLoading} dealershipId={dealershipFilter} onDealershipChange={updateDealership} /> : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="hidden lg:block">{!archived ? <PageTitle title={mode === "status" ? "Status" : "Total Leads"} /> : null}</div>
      </div>
      {mode === "status" ? <div className="flex gap-2 overflow-x-auto pb-1">{statusFilters.map((item) => <button key={item.value} onClick={() => setParams({ status: item.value, page: "1" })} className={`shrink-0 rounded-md border px-3 py-2 text-xs font-medium sm:text-sm ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</div> : null}
      {statusError ? <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusError}</div> : null}
      {statusNotice ? <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{statusNotice}</div> : null}
      <div className="hidden lg:block">
        <Table title={archived ? archiveCopy.title : mode === "status" ? "Filtered Cases" : "Assigned Leads"} headers={statusMode ? statusHeaders : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.currentStatus, "Update Status", "Documents"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} emptyMessage={archiveCopy?.empty} />
      </div>
      <div className="space-y-2 lg:hidden">
        {loading && !rows.length ? Array.from({ length: 3 }, (_, index) => <div key={index} className="h-48 animate-pulse rounded-lg border border-slate-200 bg-white" />) : null}
        {!loading && !displayedLeads.length ? <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">{archiveCopy?.empty || "No assigned leads found."}</div> : null}
        {displayedLeads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            user={user}
            accepting={acceptingLeadId === lead.id}
            onAccept={() => acceptLead(lead)}
            onUpdate={() => updateStatus(lead, "STATUS_UPDATE")}
            onDocs={() => setModal({ type: "document-actions", lead })}
            onDetails={() => setModal({ type: "details", lead })}
          />
        ))}
        {rows.length || page > 1 ? <CompactPagination page={page} total={total} hasMore={hasMore} onPage={onPage} /> : null}
      </div>
      {modal?.type === "reject" ? <RejectModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "status" ? <StatusUpdateModal lead={modal.lead} onClose={() => setModal(null)} onSaved={({ message } = {}) => { setModal(null); setStatusNotice(message || "Status updated successfully."); load(1); }} /> : null}
      {modal?.type === "details" ? <LeadDetailsModal lead={modal.lead} onClose={() => setModal(null)} /> : null}
      {modal?.type === "document-actions" ? <DocumentsSheet lead={modal.lead} onClose={() => setModal(null)} /> : null}
    </section>
  );
}
