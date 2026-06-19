import { useEffect, useState } from "react";
import { ChevronRight, FileText, MapPin, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { api } from "../../services/api.js";
import {
  DocumentsSheet,
  LeadDetailsModal,
  PendingDocsModal,
  RejectModal,
  StatusUpdateModal,
} from "./LoanExecutiveLeadModals.jsx";
import { CompactPagination, PageTitle, Table } from "./LoanExecutivePanelParts.jsx";
import { useExecutiveLeads } from "./loanExecutive.hooks.js";
import {
  caseId,
  dateTime,
  display,
  executiveStatusLabel,
  generatedAt,
  moneyValue,
  statusFilters,
} from "./loanExecutive.helpers.js";

function LeadCard({ lead, onUpdate, onDocs, onDetails }) {
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
        <button type="button" onClick={onUpdate} className="h-9 rounded-md bg-[#0d47a1] px-2 text-xs font-semibold text-white">Update</button>
        <button type="button" onClick={onDocs} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"><FileText className="h-3.5 w-3.5" /> Docs</button>
        <button type="button" onClick={onDetails} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700">Details <ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
    </article>
  );
}

export function LoanExecutiveLeadListPage({ mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [modal, setModal] = useState(null);
  const [statusError, setStatusError] = useState("");
  const requestedStatus = mode === "status" ? params.get("status") || BANK_STATUS_OPTIONS[0] : "";
  const status = mode === "status" && BANK_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : mode === "status" ? BANK_STATUS_OPTIONS[0] : "";
  console.log("SEARCH", search);
  console.log("STATUS", status);
  const { rows, total, hasMore, loading, page, onPage, load } = useExecutiveLeads({ search: debouncedSearch, status });
  useEffect(() => {
    console.log("LEADS AFTER STATE", rows);
    console.log("ROWS STATE UPDATED", rows.length, rows);
  }, [rows]);

  const updateStatus = async (lead, nextStatus) => {
    setStatusError("");
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

  const displayedLeads = rows;
  console.log("DISPLAYED LEADS", displayedLeads.length);
  console.log("TABLE INPUT", displayedLeads);
  console.log(displayedLeads.find((item) => item.caseId === "CLS-0008"));
  console.log("TABLEROWS INPUT", displayedLeads.length);

  const tableRows = displayedLeads.map((lead) => ({
    key: lead.id,
    cells: mode === "status"
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
        ...(status === "REJECTED_REASON" ? [display(lead.rejectionReason || lead.loanRejectionReason), dateTime(lead.rejectedAt || lead.updatedAt), display(lead.updatedByExecutiveName || lead.rejectedBy)] : []),
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
        <button key="status-action" onClick={() => updateStatus(lead, "STATUS_UPDATE")} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Update</button>,
        <button key="pending" onClick={() => setModal({ type: "docs", lead, status: LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS })} className="inline-flex h-8 items-center justify-center rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50">Request Docs</button>,
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>,
      ],
  }));
  console.log("TABLEROWS OUTPUT", tableRows.length);

  const statusHeaders = status === "REJECTED_REASON"
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.lastUpdated, "Rejection Reason", "Rejection Timestamp", LEAD_TABLE_LABELS.assignedExecutive, "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.lastUpdated, "Documents"];

  return (
    <section className="space-y-3 lg:space-y-4">
      <div className="hidden lg:block"><PageTitle title={mode === "status" ? "Status" : "Total Leads"} /></div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 lg:max-w-md" placeholder="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {mode === "status" ? <div className="flex gap-2 overflow-x-auto pb-1">{statusFilters.map((item) => <button key={item.value} onClick={() => setParams({ status: item.value, page: "1" })} className={`shrink-0 rounded-md border px-3 py-2 text-xs font-medium sm:text-sm ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</div> : null}
      {statusError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusError}</div> : null}
      <div className="hidden lg:block">
        <Table title={mode === "status" ? "Filtered Cases" : "Assigned Leads"} headers={mode === "status" ? statusHeaders : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.currentStatus, "Update Status", "Document Request", "Documents"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
      </div>
      <div className="space-y-2 lg:hidden">
        {loading && !rows.length ? Array.from({ length: 3 }, (_, index) => <div key={index} className="h-48 animate-pulse rounded-lg border border-slate-200 bg-white" />) : null}
        {!loading && !rows.length ? <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No assigned leads found.</div> : null}
        {rows.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onUpdate={() => updateStatus(lead, "STATUS_UPDATE")}
            onDocs={() => setModal({ type: "document-actions", lead })}
            onDetails={() => setModal({ type: "details", lead })}
          />
        ))}
        {rows.length || page > 1 ? <CompactPagination page={page} total={total} hasMore={hasMore} onPage={onPage} /> : null}
      </div>
      {modal?.type === "reject" ? <RejectModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "docs" ? <PendingDocsModal lead={modal.lead} status={modal.status} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "status" ? <StatusUpdateModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "details" ? <LeadDetailsModal lead={modal.lead} onClose={() => setModal(null)} /> : null}
      {modal?.type === "document-actions" ? <DocumentsSheet lead={modal.lead} onClose={() => setModal(null)} onRequest={() => setModal({ type: "docs", lead: modal.lead, status: LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS })} /> : null}
    </section>
  );
}
