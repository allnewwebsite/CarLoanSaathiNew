import { queryRecords, upsertRecord } from "./firestore.service.js";
import { ensureFreshProjection } from "./projectionFreshness.service.js";
import {
  latestTimestamp,
  pick,
  safeDocId,
  scopeId,
  VIEW_SEARCH_FIELDS,
  withProjectionMetadata,
} from "./projectionShared.service.js";

export async function syncLeadDetailProjection(lead = {}, extras = {}) {
  if (!lead?.id) return null;
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  const documentCounts = extras.documentCounts || {
    documents: Array.isArray(extras.documents) ? extras.documents.length : Number(lead.documentCount || 0),
    bankDocuments: Array.isArray(extras.bankDocuments) ? extras.bankDocuments.length : Number(lead.bankDocumentCount || 0),
    pendingDocuments: Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments.length : 0,
  };
  const payload = withProjectionMetadata({
    ...pick(lead),
    sourceCollection: "leads",
    sourceId: lead.id,
    viewType: "lead-detail",
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    customerSummary: {
      name: lead.fullName || lead.customerName || "",
      mobile: lead.mobile || "",
      city: lead.city || "",
    },
    executiveSummary: {
      id: lead.assignedExecutiveId || "",
      email: lead.assignedExecutiveEmail || "",
      name: lead.assignedExecutiveName || "",
      mobile: lead.assignedExecutiveMobile || "",
    },
    statusSummary: {
      status: lead.status || "NEW",
      statusUpdatedAt: lead.statusUpdatedAt || updatedAt,
      updatedByExecutiveName: lead.updatedByExecutiveName || "",
      loanExecutiveRemarks: lead.loanExecutiveRemarks || "",
    },
    documentCounts,
    timelineSummary: extras.timelineSummary || lead.timelineSummary || null,
    updatedAt,
    createdAt: lead.createdAt || updatedAt,
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: updatedAt, projectionType: "lead-detail" });
  if (Array.isArray(extras.documents)) payload.documents = extras.documents;
  if (Array.isArray(extras.bankDocuments)) payload.bankDocuments = extras.bankDocuments;
  await upsertRecord("leadDetailsProjection", safeDocId(lead.id), payload);
  return payload;
}

export function syncLeadDetailProjectionSoon(lead = {}, extras = {}) {
  Promise.resolve().then(() => syncLeadDetailProjection(lead, extras)).catch(() => {});
}

export async function getLeadDetailProjection(leadId) {
  const id = scopeId(leadId);
  if (!id) return null;
  const direct = await queryRecords("leadDetailsProjection", {
    where: [{ field: "leadId", value: id }],
    orderBy: "updatedAt",
    direction: "desc",
    limit: 1,
    maxLimit: 1,
  });
  const row = direct.data[0] || null;
  if (!row) return null;
  return await ensureFreshProjection("leadDetailsProjection", row) ? row : null;
}
