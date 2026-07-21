import { useEffect } from "react";
import { LEAD_LIFECYCLE_STATES, normalizeStatus } from "../constants/status.js";

function leadIdentity(lead = {}) {
  return [lead.id, lead.leadId, lead.sourceId, lead.caseId].map((value) => String(value || "").trim()).filter(Boolean);
}

function sameLead(left = {}, right = {}) {
  const rightIds = new Set(leadIdentity(right));
  if (!rightIds.size) return false;
  return leadIdentity(left).some((id) => rightIds.has(id));
}

function patchedLeadFromEvent(event = {}) {
  const lead = event.lead || {};
  const leadId = event.leadId || lead.leadId || lead.id;
  if (!leadId && !event.caseId) return null;
  const updatedAt = event.timestamp || lead.updatedAt || new Date().toISOString();
  const status = event.status || event.data?.status || lead.status || "";
  const hasExplicitDeadCaseState = Object.prototype.hasOwnProperty.call(lead, "isDeadCase")
    || Object.prototype.hasOwnProperty.call(event, "isDeadCase")
    || Object.prototype.hasOwnProperty.call(event.data || {}, "isDeadCase");
  const isDeadCase = hasExplicitDeadCaseState
    ? lead.isDeadCase === true || event.isDeadCase === true || event.data?.isDeadCase === true
    : false;
  return {
    ...lead,
    id: lead.id || lead.leadId || leadId,
    leadId: lead.leadId || lead.id || leadId,
    caseId: lead.caseId || event.caseId || "",
    fullName: lead.fullName || event.fullName || "",
    customerName: lead.customerName || event.customerName || event.fullName || "",
    mobile: lead.mobile || event.mobile || "",
    city: lead.city || event.city || event.dealershipCity || "",
    dealershipName: lead.dealershipName || event.dealershipName || "",
    dealerName: lead.dealerName || event.dealerName || "",
    dealerEmail: lead.dealerEmail || event.dealerEmail || "",
    dealershipCity: lead.dealershipCity || event.dealershipCity || event.city || "",
    carPrice: lead.carPrice || event.carPrice || event.carOnRoadPrice || event.onRoadPrice || "",
    carOnRoadPrice: lead.carOnRoadPrice || event.carOnRoadPrice || event.onRoadPrice || event.carPrice || "",
    onRoadPrice: lead.onRoadPrice || event.onRoadPrice || event.carOnRoadPrice || event.carPrice || "",
    loanAmount: lead.loanAmount || event.loanAmount || event.requiredLoanAmount || "",
    requiredLoanAmount: lead.requiredLoanAmount || event.requiredLoanAmount || event.loanAmount || "",
    status,
    dealershipId: lead.dealershipId || event.dealershipId || "",
    dealershipEmail: lead.dealershipEmail || event.dealershipEmail || "",
    bankId: lead.bankId || event.bankId || "",
    assignedBankName: lead.assignedBankName || event.assignedBankName || event.bankName || "",
    bankName: lead.bankName || event.bankName || event.assignedBankName || "",
    assignedBankIfsc: lead.assignedBankIfsc || event.assignedBankIfsc || event.bankIfsc || event.ifscCode || "",
    bankIfsc: lead.bankIfsc || event.bankIfsc || event.assignedBankIfsc || event.ifscCode || "",
    ifscCode: lead.ifscCode || event.ifscCode || event.assignedBankIfsc || event.bankIfsc || "",
    branchId: lead.branchId || event.branchId || "",
    bankBranchId: lead.bankBranchId || event.bankBranchId || event.branchId || "",
    bankBranchCity: lead.bankBranchCity || event.bankBranchCity || event.branchCity || "",
    branchCity: lead.branchCity || event.branchCity || event.bankBranchCity || "",
    assignedExecutiveId: lead.assignedExecutiveId || event.assignedExecutiveId || event.executiveId || "",
    assignedExecutiveName: lead.assignedExecutiveName || event.assignedExecutiveName || "",
    assignedExecutiveMobile: lead.assignedExecutiveMobile || event.assignedExecutiveMobile || event.executiveMobile || "",
    executiveMobile: lead.executiveMobile || event.executiveMobile || event.assignedExecutiveMobile || "",
    financeManagerId: lead.financeManagerId || event.financeManagerId || "",
    financeManagerName: lead.financeManagerName || event.financeManagerName || event.assignedFinanceManager || "",
    assignedFinanceManager: lead.assignedFinanceManager || event.assignedFinanceManager || event.financeManagerName || "",
    financeManagerMobile: lead.financeManagerMobile || event.financeManagerMobile || "",
    salespersonId: lead.salespersonId || event.salespersonId || "",
    salespersonName: lead.salespersonName || event.salespersonName || event.assignedSalesperson || "",
    assignedSalesperson: lead.assignedSalesperson || event.assignedSalesperson || event.salespersonName || "",
    createdAt: lead.createdAt || event.createdAt || event.generatedAt || updatedAt,
    updatedAt,
    statusUpdatedAt: status ? updatedAt : lead.statusUpdatedAt,
    realtimeUpdatedAt: updatedAt,
    documentUpdatedAt: (event.eventType || event.event) === "DOCUMENT_UPLOADED" ? updatedAt : lead.documentUpdatedAt,
    remarksUpdatedAt: (event.eventType || event.event) === "LEAD_REMARK_ADDED" ? updatedAt : lead.remarksUpdatedAt,
    isDeadCase,
    deadCaseDate: lead.deadCaseDate || event.deadCaseDate || event.data?.deadCaseDate || "",
    deadCaseBy: lead.deadCaseBy || event.deadCaseBy || event.data?.deadCaseBy || "",
    deadCaseReason: lead.deadCaseReason || event.deadCaseReason || event.data?.deadCaseReason || "",
    deadCaseNotes: lead.deadCaseNotes || event.deadCaseNotes || event.data?.deadCaseNotes || "",
    deadCaseUpdatedAt: lead.deadCaseUpdatedAt || event.deadCaseUpdatedAt || event.data?.deadCaseUpdatedAt || "",
    workflowLocation: lead.workflowLocation || event.workflowLocation || "",
    lifecycleState: lead.lifecycleState || event.lifecycleState || event.data?.lifecycleState || "",
    archivedAt: lead.archivedAt || event.archivedAt || "",
    terminalStatusAt: lead.terminalStatusAt || event.terminalStatusAt || "",
    rejectedAt: lead.rejectedAt || event.rejectedAt || "",
    rejectedBy: lead.rejectedBy || event.rejectedBy || "",
    rejectionReason: lead.rejectionReason || event.rejectionReason || "",
    rejectionRemarks: lead.rejectionRemarks || event.rejectionRemarks || "",
  };
}

function hasHydratedLeadPayload(event = {}) {
  const lead = event.lead && typeof event.lead === "object" ? event.lead : event;
  return Boolean(
    lead.fullName
    || lead.customerName
    || lead.mobile
    || lead.city
    || lead.carOnRoadPrice
    || lead.carPrice
    || lead.loanAmount
    || lead.requiredLoanAmount
  );
}

function lifecycleOf(lead = {}) {
  if (lead.isDeadCase === true || lead.lifecycleState === LEAD_LIFECYCLE_STATES.DEAD) return LEAD_LIFECYCLE_STATES.DEAD;
  if (lead.lifecycleState) return lead.lifecycleState;
  const status = normalizeStatus(lead.status);
  if (status === "REJECTED") return LEAD_LIFECYCLE_STATES.REJECTED;
  if (status === "DISBURSED") return LEAD_LIFECYCLE_STATES.DISBURSED;
  return LEAD_LIFECYCLE_STATES.ACTIVE;
}

function leadMatchesDataset(lead = {}, statusFilter = "", lifecycleFilter = LEAD_LIFECYCLE_STATES.ACTIVE) {
  // Defensive legacy fallback: a terminal status is never admitted to an
  // active table even while an older projection is being backfilled.
  const nonTerminalLegacyStatus = !["REJECTED", "DISBURSED"].includes(normalizeStatus(lead.status));
  if (!statusFilter && lifecycleFilter === LEAD_LIFECYCLE_STATES.ACTIVE && !nonTerminalLegacyStatus) return false;
  if (lifecycleOf(lead) !== lifecycleFilter) return false;
  return !statusFilter || normalizeStatus(lead.status) === normalizeStatus(statusFilter);
}

function normalizedOwnerIdentity(value) {
  const text = String(value || "").trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : text;
}

function ownerIdentities(record = {}) {
  return new Set([
    record.uid,
    record.id,
    record.email,
    record.officialEmail,
    record.executiveId,
    record.assignedExecutiveId,
    record.mobile,
    record.phone,
    record.assignedExecutiveMobile,
    record.executiveMobile,
  ].map(normalizedOwnerIdentity).filter(Boolean));
}

function reassignmentDisposition(event = {}, user = {}) {
  if ((event.eventType || event.event) !== "EXECUTIVE_REASSIGNED") return "unchanged";
  const userIds = ownerIdentities(user);
  if (!userIds.size) return "unchanged";
  const previousIds = [
    event.data?.previousExecutiveId,
    ...(Array.isArray(event.data?.previousExecutiveIds) ? event.data.previousExecutiveIds : []),
  ].map(normalizedOwnerIdentity).filter(Boolean);
  const nextIds = [
    event.assignedExecutiveId,
    event.executiveId,
    event.lead?.assignedExecutiveId,
    event.lead?.assignedExecutiveEmail,
    event.lead?.assignedExecutiveMobile,
    event.data?.assignedExecutiveId,
    event.data?.executiveId,
  ].map(normalizedOwnerIdentity).filter(Boolean);
  const isPreviousOwner = previousIds.some((id) => userIds.has(id));
  const isNextOwner = nextIds.some((id) => userIds.has(id));
  if (isPreviousOwner && !isNextOwner) return "remove";
  if (isNextOwner) return "insert";
  return "unchanged";
}

export function useRealtimeLeadPatch({ setRows, setTotal = null, statusFilter = "", lifecycleFilter = LEAD_LIFECYCLE_STATES.ACTIVE, enabled = true, pageSize = 10, user = null } = {}) {
  useEffect(() => {
    if (!enabled || typeof setRows !== "function") return undefined;
    const onRealtime = (event) => {
      const detail = event?.detail || {};
      if (!["lead", "document"].includes(detail.kind)) return;
      const patch = patchedLeadFromEvent(detail);
      if (!patch) return;
      const eventType = detail.eventType || detail.event;
      const ownershipDisposition = reassignmentDisposition(detail, user || {});
      const canInsertPatchedRow = hasHydratedLeadPayload(detail)
        && leadMatchesDataset(patch, statusFilter, lifecycleFilter)
        && (
          eventType === "LEAD_CREATED"
          || eventType === "LEAD_ASSIGNED"
          || eventType === "LEAD_REASSIGNED"
          || eventType === "BANK_ASSIGNED"
          || eventType === "EXECUTIVE_ASSIGNED"
          || eventType === "EXECUTIVE_REASSIGNED"
          || (statusFilter && ["LEAD_STATUS_UPDATED", "STATUS_UPDATED", "LEAD_REJECTED", "LEAD_DISBURSED"].includes(eventType))
        );
      setRows((current) => {
        if (!Array.isArray(current)) return current;
        if (ownershipDisposition === "remove") {
          const next = current.filter((row) => !sameLead(row, patch));
          if (next.length !== current.length && typeof setTotal === "function") {
            setTotal((value) => Math.max(0, Number(value || 0) - 1));
          }
          return next;
        }
        let changed = false;
        let removed = false;
        const next = current
          .map((row) => {
            if (!sameLead(row, patch)) return row;
            changed = true;
            return { ...row, ...patch };
          })
          .filter((row) => {
            const keep = !sameLead(row, patch) || leadMatchesDataset(row, statusFilter, lifecycleFilter);
            if (!keep) removed = true;
            return keep;
          });
        if (!changed && canInsertPatchedRow) {
          if (typeof setTotal === "function") setTotal((value) => Math.max(0, Number(value || 0) + 1));
          return [patch, ...current].slice(0, Math.max(current.length || pageSize, pageSize));
        }
        if (removed && typeof setTotal === "function") {
          setTotal((value) => Math.max(0, Number(value || 0) - 1));
        }
        return changed ? next : current;
      });
    };
    window.addEventListener("cls:realtime-event", onRealtime);
    return () => window.removeEventListener("cls:realtime-event", onRealtime);
  }, [enabled, lifecycleFilter, pageSize, setRows, setTotal, statusFilter, user]);
}

export function useRealtimeLeadDetailPatch({ leadId, setLead, enabled = true, user = null } = {}) {
  useEffect(() => {
    if (!enabled || !leadId || typeof setLead !== "function") return undefined;
    const onRealtime = (event) => {
      const detail = event?.detail || {};
      const patch = patchedLeadFromEvent(detail);
      if (!patch) return;
      const ids = new Set(leadIdentity(patch));
      if (!ids.has(String(leadId))) return;
      if (reassignmentDisposition(detail, user || {}) === "remove") {
        setLead(null);
        return;
      }
      setLead((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        const document = detail.document;
        if (document?.id) {
          const isBankDocument = Boolean(document.documentType || document.type === "query-document");
          const key = isBankDocument ? "bankDocuments" : "documents";
          const currentDocs = Array.isArray(next[key]) ? next[key] : [];
          const exists = currentDocs.some((item) => item.id === document.id);
          next[key] = exists
            ? currentDocs.map((item) => item.id === document.id ? { ...item, ...document } : item)
            : [document, ...currentDocs];
        }
        return next;
      });
    };
    window.addEventListener("cls:realtime-event", onRealtime);
    return () => window.removeEventListener("cls:realtime-event", onRealtime);
  }, [enabled, leadId, setLead, user]);
}
