import { createRecord, listRecords, updateRecord } from "./firestore.service.js";
import { getWorkflowSettings } from "./settings.service.js";

const DEFAULT_PROVIDER = process.env.WHATSAPP_PROVIDER || "cloud-api";

function normalizePhone(phoneNumber) {
  return String(phoneNumber || "").replace(/[^\d+]/g, "");
}

export function buildWhatsAppMessage(type, payload = {}) {
  const customer = payload.customerName || payload.fullName || "Customer";
  const leadId = payload.caseId || payload.leadId || payload.id || "-";
  const loanAmount = payload.loanAmount ? `Rs. ${payload.loanAmount}` : "-";

  const templates = {
    "new-lead-assigned": [
      "New Lead Assigned",
      "",
      `Customer: ${customer}`,
      `Dealer: ${payload.dealershipName || payload.dealer || "-"}`,
      `Bank: ${payload.bankName || payload.bankPartner || payload.preferredBank || "-"}`,
      `Loan Amount: ${loanAmount}`,
      "",
      "Please review within SLA.",
    ],
    "executive-reassigned": [
      "Lead Reassigned",
      "",
      `Lead ID: ${leadId}`,
      `Executive: ${payload.executiveName || "-"}`,
      "Please review within SLA.",
    ],
    "sla-breach": [
      "SLA Missed Alert",
      "",
      `Executive: ${payload.executiveName || "-"}`,
      `Lead ID: ${leadId}`,
      "",
      "Lead auto-reassigned.",
    ],
    "pending-documents": [
      "Pending Document Alert",
      "",
      `Lead ID: ${leadId}`,
      `Customer: ${customer}`,
      "",
      "Required:",
      ...((payload.documents || []).map((doc) => `- ${doc}`)),
    ],
    approval: [
      "Loan Approved",
      "",
      `Customer: ${customer}`,
      `Bank: ${payload.bankName || payload.bankPartner || "-"}`,
      `Sanction Amount: ${payload.sanctionAmount ? `Rs. ${payload.sanctionAmount}` : loanAmount}`,
    ],
    rejection: [
      "Loan Rejected",
      "",
      `Lead ID: ${leadId}`,
      `Customer: ${customer}`,
      `Reason: ${payload.reason || payload.rejectionReason || "-"}`,
    ],
    disbursement: [
      "Loan Disbursed",
      "",
      `Lead ID: ${leadId}`,
      `Customer: ${customer}`,
      `Amount: ${payload.disbursedAmount ? `Rs. ${payload.disbursedAmount}` : loanAmount}`,
    ],
    escalation: [
      "Escalation Alert",
      "",
      `Lead ID: ${leadId}`,
      payload.message || "Action required by manager.",
    ],
    "daily-summary": [
      "Daily Summary",
      "",
      `Total Leads: ${payload.totalLeads ?? 0}`,
      `Approved: ${payload.approved ?? 0}`,
      `Pending: ${payload.pending ?? 0}`,
      `Disbursed: ${payload.disbursed ?? 0}`,
    ],
  };

  return (templates[type] || [payload.title || "CarLoanSaathi Update", "", payload.message || "Action required."])
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function queueWhatsAppNotification({
  type,
  recipientRole,
  recipientId,
  phoneNumber,
  message,
  leadId,
  provider = DEFAULT_PROVIDER,
  priority = "normal",
  metadata = {},
}) {
  const settings = await getWorkflowSettings();
  if (settings.notificationSettings?.whatsappEnabled === false) return null;

  const phone = normalizePhone(phoneNumber);
  const record = await createRecord("whatsappQueue", {
    type,
    recipientRole,
    recipientId,
    phoneNumber: phone,
    message,
    leadId,
    status: phone ? "queued" : "missing-phone",
    retryCount: 0,
    provider,
    priority,
    metadata,
  });

  await createRecord("notificationLogs", {
    type,
    recipientRole,
    recipientId,
    phoneNumber: phone,
    message,
    leadId,
    status: record.status,
    retryCount: 0,
    provider,
    queueId: record.id,
  });

  return record;
}

async function sendViaProvider(item) {
  if (item.status === "missing-phone") return { ok: false, status: "missing-phone" };
  if (process.env.WHATSAPP_DRY_RUN !== "false") return { ok: true, status: "delivered", dryRun: true };

  if (item.provider === "twilio") {
    return { ok: false, status: "provider-not-configured" };
  }

  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, status: "provider-not-configured" };

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: item.phoneNumber,
      type: "text",
      text: { preview_url: false, body: item.message },
    }),
  });

  return { ok: response.ok, status: response.ok ? "delivered" : "failed", providerResponse: await response.text() };
}

export async function processWhatsAppQueue({ limit = 25 } = {}) {
  const settings = await getWorkflowSettings();
  const maxRetries = Number(settings.notificationSettings?.maxRetries || 3);
  const queue = (await listRecords("whatsappQueue"))
    .filter((item) => ["queued", "failed"].includes(item.status) && Number(item.retryCount || 0) < maxRetries)
    .slice(0, limit);

  const results = [];
  for (const item of queue) {
    try {
      const result = await sendViaProvider(item);
      const nextStatus = result.ok ? "delivered" : result.status || "failed";
      const retryCount = result.ok ? item.retryCount || 0 : Number(item.retryCount || 0) + 1;
      await updateRecord("whatsappQueue", item.id, {
        status: nextStatus,
        retryCount,
        deliveredAt: result.ok ? new Date().toISOString() : item.deliveredAt,
        providerResponse: result.providerResponse || null,
      });
      await createRecord("notificationLogs", {
        type: item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        phoneNumber: item.phoneNumber,
        message: item.message,
        leadId: item.leadId,
        status: nextStatus,
        retryCount,
        provider: item.provider,
        queueId: item.id,
      });
      results.push({ id: item.id, status: nextStatus });
    } catch (error) {
      await updateRecord("whatsappQueue", item.id, { status: "failed", retryCount: Number(item.retryCount || 0) + 1, error: error.message });
      results.push({ id: item.id, status: "failed", error: error.message });
    }
  }
  return results;
}
