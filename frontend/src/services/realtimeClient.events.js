import { invalidateGetCache } from "./api.js";
import { MUTATION_KINDS } from "./realtimeClient.constants.js";

export function leadUrlForEvent(event = {}) {
  if (event.kind === "document") return "/documents";
  if (event.kind === "notification") return "/notifications";
  if (event.kind === "staff") {
    const eventType = String(event.eventType || event.event || "");
    if (eventType.includes("SALESPERSON")) return "/dealer/salespersons";
    if (eventType.includes("FINANCE_MANAGER")) return "/dealer/finance-managers";
    return "/dealer/staff";
  }
  if (event.kind === "bank") return "/banks";
  if (event.kind === "dealer") return "/dealers";
  if (event.kind === "subscription") return "/dealer/billing";
  return "/lead-mutation";
}

export function mutationPayload(event = {}) {
  const url = leadUrlForEvent(event);
  const kind = MUTATION_KINDS.has(event.kind) ? event.kind : "lead";
  return {
    realtime: true,
    url,
    canonicalUrl: event.kind === "lead" || event.kind === "document" ? "/lead-mutation" : url,
    kind,
    event: event.event || event.eventType,
    eventType: event.eventType || event.event,
    leadId: event.leadId || event.lead?.leadId || "",
    caseId: event.caseId || event.lead?.caseId || "",
    status: event.status || event.lead?.status || "",
    dealershipId: event.dealershipId || event.lead?.dealershipId || "",
    bankId: event.bankId || event.lead?.bankId || "",
    executiveId: event.executiveId || event.lead?.assignedExecutiveId || "",
    financeManagerId: event.financeManagerId || event.lead?.financeManagerId || "",
    salespersonId: event.salespersonId || event.lead?.salespersonId || "",
    lead: event.lead || null,
    bankEvent: event.bankEvent || null,
    dealerEvent: event.dealerEvent || null,
    notification: event.notification || null,
    document: event.document || null,
    at: Date.now(),
    source: "sse",
  };
}

export function invalidateRealtimeCaches(event = {}) {
  if (event.kind === "notification") {
    return;
  }
  if (event.kind === "staff") {
    invalidateGetCache({ prefix: "/dealer/staff", purge: true });
    invalidateGetCache({ prefix: "/dealer/salespersons", purge: true });
    invalidateGetCache({ prefix: "/dealer/finance-managers", purge: true });
    invalidateGetCache({ prefix: "/gm/salespersons", purge: true });
    return;
  }
  if (event.kind === "bank") {
    invalidateGetCache({ prefix: "/catalog/banks", purge: true });
    invalidateGetCache({ prefix: "/bank/executives", purge: true });
    invalidateGetCache({ prefix: "/bank/analytics", purge: true });
    invalidateGetCache({ prefix: "/bank/leads", purge: true });
    invalidateGetCache({ prefix: "/dealer/available-banks", purge: true });
    invalidateGetCache({ prefix: "/dealer/bank-tieups", purge: true });
    invalidateGetCache({ prefix: "/admin/approvals/banks", purge: true });
    return;
  }
  if (event.kind === "dealer") {
    invalidateGetCache({ prefix: "/admin/approvals/dealerships", purge: true });
    invalidateGetCache({ prefix: "/admin/dealerships", purge: true });
    invalidateGetCache({ prefix: "/dealer/profile", purge: true });
    invalidateGetCache({ prefix: "/dashboard", purge: true });
    invalidateGetCache({ prefix: "/bank/dealerships", purge: true });
    invalidateGetCache({ prefix: "/executive/dealerships", purge: true });
    return;
  }
  if (event.kind === "subscription") {
    invalidateGetCache({ prefix: "/dealer/billing", purge: true });
    return;
  }
  [
    "/admin/leads",
    "/admin/dead-cases",
    "/bank/leads",
    "/bank/dead-cases",
    "/bank/analytics",
    "/dealer/leads",
    "/dealer/dead-cases",
    "/gm/leads",
    "/gm/dead-cases",
    "/timeline",
    "/notifications",
    "/dashboard",
  ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
}
