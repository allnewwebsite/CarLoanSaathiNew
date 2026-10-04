import { Lead } from "../types";

export const REALTIME_RECONCILE_REQUIRED = "REALTIME_RECONCILE_REQUIRED";

export const CASE_LIST_RECONCILIATION_EVENTS = new Set([
  "LEAD_CREATED", "LEAD_STATUS_UPDATED", "EXECUTIVE_ASSIGNED", "EXECUTIVE_REASSIGNED",
  "DEAD_CASE_CREATED", "DEAD_CASE_RESTORED", "DEAD_CASE_UPDATED", "DOCUMENT_UPLOADED",
  "DOCUMENT_REQUESTED",
]);

export const CASE_DETAIL_RECONCILIATION_EVENTS = new Set([
  "LEAD_STATUS_UPDATED", "EXECUTIVE_ASSIGNED", "EXECUTIVE_REASSIGNED", "DEAD_CASE_CREATED",
  "DEAD_CASE_RESTORED", "DEAD_CASE_UPDATED", "DOCUMENT_UPLOADED", "DOCUMENT_REQUESTED",
]);

export function eventLeadId(event: Record<string, any>) {
  return String(event.leadId || event.lead?.id || event.lead?.leadId || event.data?.leadId || "").trim();
}

export function mergeFirstPage(existing: Lead[], firstPage: Lead[]) {
  const merged = new Map<string, Lead>();
  for (const lead of firstPage) {
    const id = String(lead.id || lead.caseId || "").trim();
    if (id) merged.set(id, lead);
  }
  for (const lead of existing) {
    const id = String(lead.id || lead.caseId || "").trim();
    if (id && !merged.has(id)) merged.set(id, lead);
  }
  return [...merged.values()];
}
