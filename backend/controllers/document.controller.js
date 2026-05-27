import { createRecord, getRecord, queryRecords, updateRecord } from "../services/firestore.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { createNotification } from "../services/notification.service.js";
import { createShortLivedDocumentUrl, uploadLeadDocument } from "../services/storage.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

function canUploadCustomerDocument(req, lead) {
  if (req.user?.role === "super-admin") return true;
  if (req.user?.role !== "finance-desk") return false;
  const email = req.user?.email || req.user?.uid;
  return !lead || lead.dealershipId === req.user?.dealershipId || lead.dealerEmail === email || lead.dealershipEmail === email || lead.createdBy === email;
}

async function canReadCustomerDocument(req, lead) {
  if (req.user?.role === "super-admin") return true;
  const email = req.user?.email || req.user?.uid;
  if (["finance-desk", "gm-sm"].includes(req.user?.role)) {
    return lead?.dealershipId === req.user?.dealershipId || lead?.dealerEmail === email || lead?.dealershipEmail === email || lead?.createdBy === email;
  }
  if (req.user?.role === "bank-manager") {
    const managerBank = req.user?.bankId || req.user?.bankName;
    const managerBranch = req.user?.branchId || req.user?.branchCity;
    const sameBank = lead?.bankId === managerBank || lead?.assignedPartnerId === managerBank || lead?.assignedBankId === managerBank || lead?.bankPartner === managerBank || lead?.assignedBankName === managerBank || lead?.preferredBank === managerBank;
    const sameBranch = !managerBranch || lead?.branchId === managerBranch || lead?.bankBranchCity === managerBranch || lead?.branchCity === managerBranch;
    return sameBank && sameBranch;
  }
  return canReviewCustomerDocument(req, lead);
}

async function canReviewCustomerDocument(req, lead) {
  if (req.user?.role === "super-admin") return true;
  if (req.user?.role === "loan-executive") {
    const email = req.user?.email || req.user?.uid;
    if (lead?.assignedExecutiveEmail === email || lead?.assignedExecutiveId === email) return true;
    const executive = await getRecord("loanExecutives", email);
    return Boolean(executive && (lead?.assignedExecutiveId === executive.id || lead?.assignedExecutiveEmail === executive.email));
  }
  return false;
}

export async function uploadDocument(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ message: "Document file is required" });
    const lead = req.body.leadId ? await getRecord("leads", req.body.leadId) : null;
    if (!req.body.leadId || !lead) return res.status(404).json({ message: "Lead not found" });
    if (!canUploadCustomerDocument(req, lead)) return res.status(403).json({ message: "Only finance desk can upload customer documents" });
    const uploaded = await uploadLeadDocument(req.file, req.body.leadId, {
      dealershipId: lead.dealershipId || req.user?.dealershipId,
      caseId: lead.caseId,
      bankId: lead.bankId,
      assignedExecutiveId: lead.assignedExecutiveId,
      assignedExecutiveEmail: lead.assignedExecutiveEmail,
      uploadedBy: req.user?.email,
    });
    const document = await createRecord("documents", {
      leadId: req.body.leadId,
      caseId: lead.caseId || req.body.leadId,
      type: req.body.type,
      status: "Uploaded",
      file: uploaded?.originalName || req.file?.originalname,
      url: null,
      storagePath: uploaded?.storagePath,
      filePath: uploaded?.storagePath,
      fileType: req.body.type || req.file?.mimetype,
      mimeType: uploaded?.mimeType,
      size: uploaded?.size,
      uploadedBy: req.user?.email,
      dealershipId: lead.dealershipId || req.user?.dealershipId || null,
      bankId: lead.bankId || null,
      assignedExecutiveId: lead.assignedExecutiveId || null,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      newValue: req.body.type || req.file?.originalname,
      leadId: req.body.leadId,
      meta: { documentId: document.id, caseId: lead.caseId, dealershipId: document.dealershipId, bankId: document.bankId },
    });
    await addTimelineEvent({
      leadId: req.body.leadId,
      eventType: TIMELINE_EVENTS.DOCUMENT_UPLOADED,
      title: "Document Uploaded",
      description: req.body.type || req.file?.originalname || "Document uploaded",
      actorName: req.user?.email || "user",
      actorRole: req.user?.role || "user",
      metadata: { documentId: document.id, documentType: req.body.type, fileName: req.file?.originalname },
    });
    await createNotification({
      type: "documents-uploaded",
      title: "Documents uploaded",
      message: `${req.body.type || "Document"} uploaded for lead ${lead.caseId || req.body.leadId}`,
      leadId: req.body.leadId,
      recipientRole: "loan-executive",
      meta: { caseId: lead.caseId, documents: [req.body.type || "Document"] },
    });
    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
}

export async function getLeadDocuments(req, res, next) {
  try {
    const lead = await getRecord("leads", req.params.leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    if (!(await canReadCustomerDocument(req, lead))) return res.status(403).json({ message: "Document access denied" });
    const documentsPage = await queryRecords("documents", {
      where: [{ field: "leadId", value: req.params.leadId }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 50,
      maxLimit: 50,
    });
    const documents = documentsPage.data.map((document) => ({ ...document, url: null }));
    res.json(documents);
  } catch (error) {
    next(error);
  }
}

export async function updateDocumentStatus(req, res, next) {
  try {
    const existingDocument = await getRecord("documents", req.params.id);
    if (!existingDocument) return res.status(404).json({ message: "Document not found" });
    const lead = existingDocument.leadId ? await getRecord("leads", existingDocument.leadId) : null;
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    if (!(await canReviewCustomerDocument(req, lead))) return res.status(403).json({ message: "Document access denied" });
    const document = await updateRecord("documents", req.params.id, {
      status: req.body.status,
      note: req.body.note,
      reviewedBy: req.user?.email,
    });
    const needsDocumentFollowup = ["Pending", "Requested", "Rejected"].includes(req.body.status);
    if (needsDocumentFollowup) {
      await updateRecord("leads", document.leadId, {
        status: LEAD_STATUSES.DOCS_PENDING,
        pendingDocuments: [...new Set([...(Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments : []), document.type].filter(Boolean))],
        pendingDocumentReason: req.body.note || `${document.type || "Document"} needs attention`,
      });
      await createNotification({
        type: "pending-documents",
        title: "Pending document requested",
        message: req.body.note || `${document.type || "Document"} needs attention`,
        leadId: document.leadId,
        dealerEmail: lead.dealerEmail,
        recipientRole: "finance-desk",
        recipientId: lead.dealerEmail,
        phoneNumber: lead.dealerMobile || lead.mobile,
        priority: "high",
        meta: { caseId: lead.caseId, customerName: lead.fullName || lead.customerName, documentType: document.type, documentStatus: req.body.status },
      });
    }
    await writeAuditLog({
      req,
      actionType: needsDocumentFollowup ? AUDIT_ACTIONS.PENDING_DOCUMENT_REQUESTED : "DOCUMENT_STATUS_UPDATED",
      oldValue: existingDocument.status,
      newValue: req.body.status,
      leadId: document.leadId,
      meta: { documentId: document.id, documentType: document.type, note: req.body.note, caseId: lead.caseId },
    });
    await addTimelineEvent({
      leadId: document.leadId,
      eventType: req.body.status === "Pending" || req.body.status === "Requested" ? TIMELINE_EVENTS.PENDING_DOCUMENTS_REQUESTED : TIMELINE_EVENTS.STATUS_CHANGED,
      title: `Document ${req.body.status || "Updated"}`,
      description: req.body.note || document.type || "Document status updated",
      actorName: req.user?.email || "user",
      actorRole: req.user?.role || "user",
      metadata: { documentId: document.id, documentStatus: req.body.status, documentType: document.type },
    });
    res.json(document);
  } catch (error) {
    next(error);
  }
}

export async function viewDocument(req, res, next) {
  try {
    const document = await getRecord("documents", req.params.id);
    if (!document) return res.status(404).json({ message: "Document not found" });
    const lead = document.leadId ? await getRecord("leads", document.leadId) : null;
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    if (!(await canReadCustomerDocument(req, lead))) return res.status(403).json({ message: "Document access denied" });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.DOCUMENT_VIEWED,
      leadId: document.leadId,
      meta: { documentId: document.id, documentType: document.type, caseId: lead.caseId },
    });
    const url = await createShortLivedDocumentUrl(document.storagePath || document.filePath);
    res.json({ ...document, url, expiresInSeconds: url ? 300 : 0 });
  } catch (error) {
    next(error);
  }
}
