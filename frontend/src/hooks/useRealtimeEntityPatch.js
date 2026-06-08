import { useEffect } from "react";
import { normalizeStatus } from "../constants/status.js";

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
  return {
    ...lead,
    id: lead.id || lead.leadId || leadId,
    leadId: lead.leadId || lead.id || leadId,
    caseId: lead.caseId || event.caseId || "",
    status: event.status || lead.status || "",
    dealershipId: lead.dealershipId || event.dealershipId || "",
    bankId: lead.bankId || event.bankId || "",
    assignedExecutiveId: lead.assignedExecutiveId || event.executiveId || "",
    financeManagerId: lead.financeManagerId || event.financeManagerId || "",
    salespersonId: lead.salespersonId || event.salespersonId || "",
    updatedAt,
    statusUpdatedAt: event.status ? updatedAt : lead.statusUpdatedAt,
  };
}

function statusMatchesFilter(lead = {}, statusFilter = "") {
  if (!statusFilter) return true;
  return normalizeStatus(lead.status) === normalizeStatus(statusFilter);
}

export function useRealtimeLeadPatch({ setRows, statusFilter = "", enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof setRows !== "function") return undefined;
    const onRealtime = (event) => {
      const detail = event?.detail || {};
      if (!["lead", "document"].includes(detail.kind)) return;
      const patch = patchedLeadFromEvent(detail);
      if (!patch) return;
      setRows((current) => {
        if (!Array.isArray(current) || !current.length) return current;
        let changed = false;
        const next = current
          .map((row) => {
            if (!sameLead(row, patch)) return row;
            changed = true;
            return { ...row, ...patch };
          })
          .filter((row) => !sameLead(row, patch) || statusMatchesFilter(row, statusFilter));
        return changed ? next : current;
      });
    };
    window.addEventListener("cls:realtime-event", onRealtime);
    return () => window.removeEventListener("cls:realtime-event", onRealtime);
  }, [enabled, setRows, statusFilter]);
}

export function useRealtimeLeadDetailPatch({ leadId, setLead, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || !leadId || typeof setLead !== "function") return undefined;
    const onRealtime = (event) => {
      const detail = event?.detail || {};
      const patch = patchedLeadFromEvent(detail);
      if (!patch) return;
      const ids = new Set(leadIdentity(patch));
      if (!ids.has(String(leadId))) return;
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
  }, [enabled, leadId, setLead]);
}
