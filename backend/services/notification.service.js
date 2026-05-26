import { createRecord, listRecords, updateRecord } from "./firestore.service.js";
import { buildWhatsAppMessage, queueWhatsAppNotification } from "./whatsapp.service.js";

export async function createNotification({
  type,
  title,
  message,
  leadId,
  partnerId,
  dealerEmail,
  admin = false,
  meta = {},
  recipientRole,
  recipientId,
  phoneNumber,
  priority = "normal",
  userId,
  dealershipId,
  bankId,
  assignedExecutiveId,
}) {
  const lead = leadId ? (await listRecords("leads")).find((entry) => entry.id === leadId || entry.caseId === leadId) : null;
  const caseId = lead?.caseId || meta.caseId || null;
  const targetUserId = userId || recipientId || partnerId || dealerEmail || null;
  const notification = await createRecord("notifications", {
    userId: targetUserId,
    type,
    title,
    message,
    leadId,
    caseId,
    partnerId,
    dealerEmail,
    dealershipId: dealershipId || lead?.dealershipId || meta.dealershipId || null,
    bankId: bankId || lead?.bankId || meta.bankId || null,
    assignedExecutiveId: assignedExecutiveId || lead?.assignedExecutiveId || meta.assignedExecutiveId || null,
    admin,
    recipientRole,
    recipientId,
    priority,
    read: false,
    meta,
  });
  await createRecord("notificationLogs", {
    notificationId: notification.id,
    userId: targetUserId,
    role: recipientRole || (admin ? "super-admin" : null),
    type,
    leadId,
    caseId,
    dealershipId: notification.dealershipId,
    bankId: notification.bankId,
    assignedExecutiveId: notification.assignedExecutiveId,
    status: "created",
  });

  const whatsappMessage = message || buildWhatsAppMessage(type, { ...meta, leadId: caseId || leadId, caseId });
  await queueWhatsAppNotification({
    type,
    recipientRole: recipientRole || (admin ? "super-admin" : partnerId ? "loan-executive" : dealerEmail ? "finance-desk" : "system"),
    recipientId: recipientId || partnerId || dealerEmail || "admin",
    phoneNumber: phoneNumber || meta.phoneNumber || meta.mobile,
    message: whatsappMessage,
    leadId,
    priority,
    metadata: { notificationId: notification.id, caseId, ...meta },
  });

  return notification;
}

export async function getNotifications({ query = {}, actor = {} } = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const role = actor.role;
  const id = actor.email || actor.uid;
  const search = String(query.search || "").trim().toLowerCase();
  const type = String(query.type || "").trim();
  const unreadOnly = query.unread === "true";

  const leads = await listRecords("leads");
  const executives = role === "loan-executive" ? await listRecords("loanExecutives") : [];
  const managers = role === "bank-manager" ? await listRecords("branchManagers") : [];
  const executive = executives.find((item) => item.email === id || item.id === id);
  const manager = managers.find((item) => item.email === id || item.id === id);
  const canReadLeadNotification = (item) => {
    if (!item.leadId) return item.recipientId === id || item.dealerEmail === id || item.partnerId === id;
    const lead = leads.find((entry) => entry.id === item.leadId);
    if (!lead) return false;
    if (["finance-desk", "gm-sm"].includes(role)) return lead.dealerEmail === id || lead.dealershipEmail === id || lead.createdBy === id;
    if (role === "loan-executive") {
      return lead.assignedExecutiveEmail === id
        || lead.assignedExecutiveId === id
        || (executive && (lead.assignedExecutiveId === executive.id || lead.assignedExecutiveEmail === executive.email));
    }
    if (role === "bank-manager") {
      const managerCity = manager?.branchCity || manager?.city || manager?.operatingCity;
      const leadCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || lead.city;
      const managerBank = manager?.bankName || manager?.bankPartnerId;
      const sameCity = !managerCity || managerCity === leadCity;
      const sameBank = !managerBank || lead.assignedPartnerId === managerBank || lead.bankPartner === managerBank || lead.preferredBank === managerBank;
      return sameCity && sameBank;
    }
    return false;
  };

  let items = await listRecords("notifications");
  items = items.filter((item) => {
    const allowed = role === "super-admin"
      || item.recipientId === id
      || item.dealerEmail === id
      || item.partnerId === id
      || (item.recipientRole === role && canReadLeadNotification(item));
    const typeOk = !type || item.type === type;
    const unreadOk = !unreadOnly || item.read === false;
    const searchOk = !search || [item.title, item.message, item.caseId, item.leadId].filter(Boolean).join(" ").toLowerCase().includes(search);
    return allowed && typeOk && unreadOk && searchOk;
  });

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    total: items.length,
    unread: items.filter((item) => !item.read).length,
    page,
    limit,
  };
}

export async function markNotificationRead(id, actor = {}) {
  const item = (await listRecords("notifications")).find((entry) => entry.id === id);
  if (!item) {
    const error = new Error("Notification not found");
    error.status = 404;
    throw error;
  }
  const lead = item.leadId ? (await listRecords("leads")).find((entry) => entry.id === item.leadId) : null;
  const actorId = actor.email || actor.uid;
  const manager = actor.role === "bank-manager"
    ? (await listRecords("branchManagers")).find((entry) => entry.email === actorId || entry.id === actorId)
    : null;
  const managerCity = manager?.branchCity || manager?.city || manager?.operatingCity;
  const leadCity = lead?.bankBranchCity || lead?.branchCity || lead?.routingCity || lead?.dealershipCity || lead?.city;
  const managerBank = manager?.bankName || manager?.bankPartnerId;
  const canAccessLeadScoped = lead && (
    (["finance-desk", "gm-sm"].includes(actor.role) && [lead.dealerEmail, lead.dealershipEmail, lead.createdBy].includes(actorId))
    || (actor.role === "loan-executive" && [lead.assignedExecutiveEmail, lead.assignedExecutiveId].includes(actorId))
    || (actor.role === "bank-manager" && (!managerCity || managerCity === leadCity) && (!managerBank || [lead.assignedPartnerId, lead.bankPartner, lead.preferredBank].includes(managerBank)))
  );
  const canAccess = actor.role === "super-admin"
    || item.recipientId === actor.email
    || item.dealerEmail === actor.email
    || item.partnerId === actor.email
    || (item.recipientRole === actor.role && canAccessLeadScoped);
  if (!canAccess) {
    const error = new Error("Notification access denied");
    error.status = 403;
    throw error;
  }
  const updated = await updateRecord("notifications", id, { read: true, readAt: new Date().toISOString() });
  await createRecord("notificationLogs", {
    notificationId: id,
    userId: actor.email || actor.uid,
    role: actor.role,
    type: item.type,
    leadId: item.leadId || null,
    caseId: item.caseId || null,
    dealershipId: item.dealershipId || null,
    bankId: item.bankId || null,
    assignedExecutiveId: item.assignedExecutiveId || null,
    status: "read",
  });
  return updated;
}
