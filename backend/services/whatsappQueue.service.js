import { getRecord, queryRecords, runRecordTransaction, updateRecord } from "./firestore.service.js";
import { logError, logInfo } from "./logger.service.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { buildWhatsAppMessage } from "./whatsappTemplates.service.js";
import { sendWhatsApp } from "./whatsappTransport.service.js";
import {
  assignedExecutivePhone,
  caseId,
  customerName,
  DEFAULT_PROVIDER,
  enabledByEnv,
  enabledBySettings,
  financeManagerPhone,
  isTerminalNotificationStatus,
  logWhatsAppNotification,
  normalizePhone,
  notificationIdentity,
  nowIso,
  processingWhatsAppKeys,
  pushRuntimeEvent,
  recordFailure,
  safeErrorDetail,
  whatsappRuntime,
} from "./whatsappShared.service.js";

export async function queueWhatsAppNotification({
  type,
  eventType,
  recipientRole,
  recipientId,
  phoneNumber,
  message,
  leadId,
  caseId: rawCaseId,
  provider = DEFAULT_PROVIDER,
  priority = "normal",
  metadata = {},
}) {
  if (!enabledByEnv()) return null;
  if (!(await enabledBySettings())) return null;

  const phone = normalizePhone(phoneNumber);
  const resolvedEventType = eventType || type || "WHATSAPP_MESSAGE";
  const identity = notificationIdentity({ leadId, caseId: rawCaseId, eventType: resolvedEventType, phoneNumber: phone, metadata });
  const existingQueueItem = await getRecord("whatsappQueue", identity.notificationKey).catch(() => null);
  if (existingQueueItem) {
    pushRuntimeEvent({
      status: "deduped",
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      notificationKey: identity.notificationKey,
    });
    logInfo("WHATSAPP_NOTIFICATION_DEDUPED", {
      notificationKey: identity.notificationKey,
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      recipient: identity.recipient,
      status: existingQueueItem.status,
      messageSid: existingQueueItem.messageSid || null,
    });
    return { ...existingQueueItem, deduped: true };
  }

  const existingLog = await getRecord("notificationLogs", identity.notificationKey).catch(() => null);
  if (existingLog && (isTerminalNotificationStatus(existingLog.status) || existingLog.messageSid)) {
    pushRuntimeEvent({
      status: "deduped",
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      notificationKey: identity.notificationKey,
    });
    logInfo("WHATSAPP_NOTIFICATION_DEDUPED", {
      notificationKey: identity.notificationKey,
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      recipient: identity.recipient,
      status: existingLog.status,
      messageSid: existingLog.messageSid || null,
    });
    return { ...existingLog, deduped: true };
  }

  const timestamp = nowIso();
  const queuePayload = {
    id: identity.notificationKey,
    notificationKey: identity.notificationKey,
    type: type || resolvedEventType,
    eventType: identity.canonicalType,
    originalEventType: resolvedEventType,
    recipientRole,
    recipientId,
    recipient: recipientId || identity.recipient || null,
    phoneNumber: phone,
    phone,
    message,
    leadId: identity.leadId,
    caseId: identity.caseId,
    status: phone ? "queued" : "missing-phone",
    retryCount: Number(existingQueueItem?.retryCount || 0),
    provider,
    priority,
    metadata: { ...metadata, notificationKey: identity.notificationKey, originalEventType: resolvedEventType },
    deliveryResult: null,
    queuedAt: timestamp,
    timestamp,
  };
  const creation = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get("whatsappQueue", identity.notificationKey);
    if (existing) return { created: false, record: existing };
    await transaction.set("whatsappQueue", identity.notificationKey, queuePayload, { merge: false });
    return { created: true, record: queuePayload };
  });
  if (!creation.created) {
    logInfo("WHATSAPP_NOTIFICATION_DEDUPED", {
      notificationKey: identity.notificationKey,
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      recipient: identity.recipient,
      status: creation.record.status,
    });
    return { ...creation.record, deduped: true };
  }
  const record = creation.record;

  whatsappRuntime.queued += 1;
  whatsappRuntime.pending += phone ? 1 : 0;
  pushRuntimeEvent({ status: record.status, eventType: identity.canonicalType, caseId: identity.caseId, notificationKey: identity.notificationKey });

  await logWhatsAppNotification({
    notificationKey: identity.notificationKey,
    type: type || resolvedEventType,
    eventType: identity.canonicalType,
    recipientRole,
    recipientId,
    recipient: identity.recipient,
    phone,
    message,
    leadId: identity.leadId,
    caseId: identity.caseId,
    status: record.status,
    retryCount: 0,
    provider,
    queueId: record.id,
    messageSid: null,
    deliveryResult: { status: record.status, queuedAt: timestamp },
    metadata,
  });

  if (phone) {
    addQueueJob(QUEUE_NAMES.WHATSAPP, "whatsapp-send", { queueId: record.id, jobId: record.id }, {
      jobId: record.id,
      priority,
      fallback: (payload) => processWhatsAppQueue({ queueId: payload?.queueId, limit: 1 }),
    }).catch((error) => logError("WhatsApp queue job enqueue failed", { error: error.message, eventType: identity.canonicalType, notificationKey: identity.notificationKey }));
  }

  return record;
}

async function sendViaProvider(item) {
  if (item.status === "missing-phone") return { ok: false, status: "missing-phone", error: "Recipient phone number is missing" };
  if (item.messageSid) return { ok: true, status: item.status || "sent", messageSid: item.messageSid, providerStatus: item.providerStatus || item.status || "sent" };
  return sendWhatsApp({
    to: item.phoneNumber || item.phone,
    message: item.message,
    eventType: item.eventType || item.type,
    metadata: {
      ...(item.metadata || {}),
      leadId: item.leadId,
      caseId: item.caseId || item.metadata?.caseId,
      recipientRole: item.recipientRole,
      recipientId: item.recipientId,
      notificationKey: item.notificationKey,
    },
    provider: item.provider || DEFAULT_PROVIDER,
  });
}

export async function processWhatsAppQueue({ limit = 25, queueId = null } = {}) {
  const settings = await getWorkflowSettings();
  const maxRetries = Number(settings.notificationSettings?.maxRetries || 3);
  const queue = queueId
    ? [await getRecord("whatsappQueue", queueId).catch(() => null)].filter(Boolean)
    : (await Promise.all([
      queryRecords("whatsappQueue", { where: [{ field: "status", value: "queued" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
      queryRecords("whatsappQueue", { where: [{ field: "status", value: "failed" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
    ]))
      .flatMap((page) => page.data || [])
      .sort((left, right) => String(left.createdAt || left.queuedAt || "").localeCompare(String(right.createdAt || right.queuedAt || "")))
      .slice(0, limit);

  const results = [];
  for (const item of queue
    .filter((candidate) => ["queued", "failed"].includes(String(candidate.status || "").toLowerCase()))
    .filter((candidate) => Number(candidate.retryCount || 0) < maxRetries)
    .filter((candidate) => !candidate.messageSid)) {
    const lockKey = item.notificationKey || item.id;
    if (processingWhatsAppKeys.has(lockKey)) {
      results.push({ id: item.id, status: "skipped-processing" });
      continue;
    }
    processingWhatsAppKeys.add(lockKey);
    try {
      const notificationKey = lockKey;
      const claimed = await runRecordTransaction(async (transaction) => {
        const current = await transaction.get("whatsappQueue", item.id);
        if (!current || !["queued", "failed"].includes(String(current.status || "").toLowerCase()) || current.messageSid || Number(current.retryCount || 0) >= maxRetries) return null;
        const processingStartedAt = nowIso();
        await transaction.set("whatsappQueue", item.id, { status: "processing", processingStartedAt, lastAttemptAt: processingStartedAt }, { merge: true });
        return { ...current, status: "processing", processingStartedAt, lastAttemptAt: processingStartedAt };
      });
      if (!claimed) {
        results.push({ id: item.id, status: "skipped-claimed" });
        continue;
      }
      const result = await sendViaProvider(claimed);
      const failed = !result.ok;
      const sidReceived = Boolean(result.messageSid);
      const nextStatus = failed && !sidReceived ? "failed" : sidReceived ? "sent" : "sent";
      const retryCount = failed ? Number(claimed.retryCount || 0) + 1 : Number(claimed.retryCount || 0);
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      await updateRecord("whatsappQueue", item.id, {
        status: nextStatus,
        providerStatus: result.providerStatus || result.status || null,
        retryCount,
        deliveredAt: !failed || sidReceived ? nowIso() : item.deliveredAt || null,
        failedAt: failed && !sidReceived ? nowIso() : item.failedAt || null,
        messageSid: result.messageSid || null,
        deliveryResult: result.deliveryResult || null,
        error: result.error || null,
      });
      await logWhatsAppNotification({
        notificationKey,
        type: item.type,
        eventType: item.eventType || item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        recipient: item.recipient || item.recipientId || null,
        phone: item.phoneNumber,
        message: item.message,
        leadId: item.leadId,
        caseId: item.caseId || item.metadata?.caseId || null,
        status: nextStatus,
        retryCount,
        provider: item.provider,
        queueId: item.id,
        messageSid: result.messageSid || null,
        deliveryResult: result.deliveryResult || null,
        error: result.error || null,
        metadata: item.metadata || {},
      });
      results.push({ id: item.id, status: nextStatus, messageSid: result.messageSid || null });
    } catch (error) {
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      recordFailure({ error: error.message, eventType: item.eventType || item.type });
      const notificationKey = item.notificationKey || item.id;
      await updateRecord("whatsappQueue", item.id, {
        status: "failed",
        retryCount: Number(item.retryCount || 0) + 1,
        failedAt: nowIso(),
        error: safeErrorDetail(error.message),
      });
      await logWhatsAppNotification({
        notificationKey,
        type: item.type,
        eventType: item.eventType || item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        recipient: item.recipient || item.recipientId || null,
        phone: item.phoneNumber || item.phone,
        message: item.message,
        leadId: item.leadId,
        caseId: item.caseId || item.metadata?.caseId || null,
        status: "failed",
        retryCount: Number(item.retryCount || 0) + 1,
        provider: item.provider,
        queueId: item.id,
        error: safeErrorDetail(error.message),
        metadata: item.metadata || {},
      });
      results.push({ id: item.id, status: "failed", error: safeErrorDetail(error.message) });
    } finally {
      processingWhatsAppKeys.delete(lockKey);
    }
  }
  return results;
}

export function queueLeadAssignedWhatsApp(lead = {}) {
  if (!lead.assignedExecutiveId && !lead.assignedExecutiveEmail && !assignedExecutivePhone(lead)) return null;
  const eventVersion = lead.reassignedAt
    || lead.assignmentTimestamp
    || lead.assignedAt
    || lead.updatedAt
    || lead.createdAt
    || "";
  return queueWhatsAppNotification({
    type: "lead-assigned",
    eventType: "LEAD_ASSIGNED",
    recipientRole: "loan-executive",
    recipientId: lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || null,
    phoneNumber: assignedExecutivePhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("LEAD_ASSIGNED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      loanAmount: lead.requiredLoanAmount || lead.loanAmount,
      bankName: lead.assignedBankName || lead.bankName,
      branchLocation: lead.branchLocation || lead.bankBranchLocation,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      eventVersion,
      recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null,
    },
  });
}

export function queueDocumentsRequiredWhatsApp({ lead = {}, documents = [] } = {}) {
  const documentKey = [...documents].map((document) => String(document || "").trim()).filter(Boolean).sort().join("-");
  const eventVersion = lead.documentsRequestedAt
    || lead.pendingDocumentsRequestedAt
    || lead.updatedAt
    || `${lead.status || ""}-${documentKey}`;
  return queueWhatsAppNotification({
    type: "documents-required",
    eventType: "DOCUMENTS_REQUIRED",
    recipientRole: "finance-manager",
    recipientId: lead.financeManagerId || lead.financeManagerEmail || lead.assignedFinanceManager || null,
    phoneNumber: financeManagerPhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("DOCUMENTS_REQUIRED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      documents,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      documents,
      eventVersion,
      recipient: lead.financeManagerName || lead.assignedFinanceManager || null,
    },
  });
}

export function queueStatusUpdatedWhatsApp({ lead = {}, statusLabel = "" } = {}) {
  const eventVersion = lead.statusUpdatedAt
    || lead.updatedAt
    || `${lead.status || statusLabel}`;
  return queueWhatsAppNotification({
    type: "status-updated",
    eventType: "STATUS_UPDATED",
    recipientRole: "finance-manager",
    recipientId: lead.financeManagerId || lead.financeManagerEmail || lead.assignedFinanceManager || null,
    phoneNumber: financeManagerPhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "normal",
    message: buildWhatsAppMessage("STATUS_UPDATED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      statusLabel,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      status: statusLabel,
      eventVersion,
      recipient: lead.financeManagerName || lead.assignedFinanceManager || null,
    },
  });
}

export function queueDocumentsUploadedWhatsApp({ lead = {}, documents = [] } = {}) {
  const documentKey = [...documents].map((document) => String(document || "").trim()).filter(Boolean).sort().join("-");
  const eventVersion = lead.documentsUploadedAt
    || lead.updatedAt
    || `${lead.status || ""}-${documentKey}`;
  return queueWhatsAppNotification({
    type: "documents-uploaded",
    eventType: "DOCUMENTS_UPLOADED",
    recipientRole: "loan-executive",
    recipientId: lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || null,
    phoneNumber: assignedExecutivePhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("DOCUMENTS_UPLOADED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      documents,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      documents,
      eventVersion,
      recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null,
    },
  });
}
