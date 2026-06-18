import crypto from "node:crypto";
import {
  queryRecords,
  runRecordTransaction,
  updateRecord,
  upsertRecord,
} from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { REALTIME_EVENTS } from "./realtime.service.js";
import { logError, logInfo } from "./logger.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import {
  addDays,
  baseSubscription,
  cleanId,
  nextLifecycleCheckAt,
  professionalPendingSubscription,
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUSES,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import {
  dealershipRecord,
  publishSubscription,
  storedSubscriptionRecord,
  SUBSCRIPTION_COLLECTION,
  syncSubscriptionSummary,
} from "./subscriptionShared.service.js";
import { isProfessionalPlan } from "../utils/onboardingPlan.js";

export {
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUSES,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";

const WARNING_DAYS = [7, 3, 1];

export async function initializeDealershipTrial({
  dealershipId,
  dealership = null,
  approvedAt = new Date().toISOString(),
  trialDays = SUBSCRIPTION_PLAN.trialDays,
  actor = null,
} = {}) {
  const id = cleanId(dealershipId);
  if (!id) throw new Error("Dealership ID is required to start trial");
  const profile = dealership || await dealershipRecord(id) || {};
  const created = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get(SUBSCRIPTION_COLLECTION, id);
    if (existing?.trialStartDate) return subscriptionSnapshot(existing);
    const subscription = baseSubscription({
      dealershipId: id,
      dealership: profile,
      trialStartDate: approvedAt,
      trialDays,
    });
    transaction.set(SUBSCRIPTION_COLLECTION, id, storedSubscriptionRecord(subscription), { merge: true });
    return subscription;
  });
  await syncSubscriptionSummary(created);
  publishSubscription(created, actor, REALTIME_EVENTS.SUBSCRIPTION_TRIAL_STARTED);
  await writeAuditLog({
    actorId: actor?.email || actor?.uid || "system",
    actorRole: actor?.role || "system",
    actionType: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_ACTIVATED,
    targetEntity: "subscription",
    targetId: id,
    newValue: {
      trialStartDate: created.trialStartDate,
      trialEndDate: created.trialEndDate,
      status: created.subscriptionStatus,
    },
    meta: { dealershipId: id, source: "dealership-approval" },
  }).catch((error) => logError("Subscription trial audit failed", { dealershipId: id, error: error.message }));
  return created;
}

export async function initializeProfessionalSubscriptionPending({
  dealershipId,
  dealership = null,
  approvedAt = new Date().toISOString(),
  actor = null,
} = {}) {
  const id = cleanId(dealershipId);
  if (!id) throw new Error("Dealership ID is required to initialize subscription");
  const profile = dealership || await dealershipRecord(id) || {};
  const created = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get(SUBSCRIPTION_COLLECTION, id);
    if (existing?.subscriptionEndDate || existing?.paymentStatus === "PAID") return subscriptionSnapshot(existing);
    const subscription = professionalPendingSubscription({ dealershipId: id, dealership: profile, approvedAt });
    transaction.set(SUBSCRIPTION_COLLECTION, id, storedSubscriptionRecord(subscription), { merge: true });
    return subscription;
  });
  await syncSubscriptionSummary(created);
  publishSubscription(created, actor);
  return created;
}

export async function getDealershipSubscription(dealershipId, { initialize = true } = {}) {
  const id = cleanId(dealershipId);
  if (!id) return null;
  const existing = await import("./firestore.service.js")
    .then(({ getRecord }) => getRecord(SUBSCRIPTION_COLLECTION, id))
    .catch(() => null);
  if (existing) return subscriptionSnapshot(existing);
  if (!initialize) return null;
  const dealership = await dealershipRecord(id);
  if (!dealership || dealership.approved === false || dealership.active === false) return null;
  if (isProfessionalPlan(dealership.selectedPlan)) {
    return initializeProfessionalSubscriptionPending({
      dealershipId: id,
      dealership,
      approvedAt: dealership.approvedAt || dealership.reviewedAt || dealership.accountApprovedAt || new Date().toISOString(),
    });
  }
  return initializeDealershipTrial({
    dealershipId: id,
    dealership,
    approvedAt: dealership.approvedAt || dealership.reviewedAt || dealership.accountApprovedAt || new Date().toISOString(),
  });
}

export async function assertLeadCreationAllowed(dealershipId) {
  const subscription = await getDealershipSubscription(dealershipId);
  const snapshot = subscriptionSnapshot(subscription || {});
  if (!subscription || !snapshot.leadCreationAllowed) {
    const paymentRequired = snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.PAYMENT_PENDING;
    const error = new Error(paymentRequired
      ? "Professional Plan payment is required before dashboard access can be activated."
      : "Your subscription has expired. Lead creation has been disabled. Please renew your subscription.");
    error.status = 403;
    error.code = paymentRequired ? "SUBSCRIPTION_PAYMENT_REQUIRED" : "SUBSCRIPTION_EXPIRED";
    error.subscription = snapshot;
    throw error;
  }
  return snapshot;
}

async function sendExpiryWarning(subscription, daysRemaining) {
  const endKey = String(subscription.entitlementEndDate || "").slice(0, 10);
  const warningId = `${crypto.createHash("sha256").update(subscription.dealershipId).digest("hex").slice(0, 16)}_${endKey}_${daysRemaining}`;
  const now = new Date();
  const claimed = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get("subscriptionWarnings", warningId);
    if (existing?.status === "SENT" || existing?.status === "CLAIMED") return false;
    if (existing?.nextAttemptAt && new Date(existing.nextAttemptAt) > now) return false;
    const attempts = Number(existing?.attempts || 0) + 1;
    if (attempts > 3) return false;
    transaction.set("subscriptionWarnings", warningId, {
      dealershipId: subscription.dealershipId,
      daysRemaining,
      entitlementEndDate: subscription.entitlementEndDate,
      status: "CLAIMED",
      attempts,
      claimedAt: now.toISOString(),
      createdAt: existing?.createdAt || now.toISOString(),
      nextAttemptAt: null,
    }, { merge: true });
    return true;
  });
  if (!claimed) return false;
  try {
    await createNotification({
      type: "subscription-expiry-warning",
      title: `${daysRemaining} Day${daysRemaining === 1 ? "" : "s"} Remaining`,
      message: `Your CarLoanSaathi Professional access expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Renew to keep lead creation enabled.`,
      recipientRole: "finance-desk",
      recipientId: subscription.financeDeskEmail || subscription.dealershipId,
      dealerEmail: subscription.dealershipId,
      dealershipId: subscription.dealershipId,
      phoneNumber: subscription.financeDeskMobile,
      priority: daysRemaining === 1 ? "high" : "normal",
      entityType: "subscription",
      entityId: subscription.dealershipId,
      meta: {
        dealershipId: subscription.dealershipId,
        daysRemaining,
        entitlementEndDate: subscription.entitlementEndDate,
        notificationKey: warningId,
      },
    });
    await updateRecord("subscriptionWarnings", warningId, {
      status: "SENT",
      sentAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    await updateRecord("subscriptionWarnings", warningId, {
      status: "FAILED",
      error: String(error.message || "Notification failed").slice(0, 300),
      nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
}

export async function processSubscriptionLifecycle({ limit = 100 } = {}) {
  const now = new Date();
  const page = await queryRecords(SUBSCRIPTION_COLLECTION, {
    where: [{ field: "nextLifecycleCheckAt", op: "<=", value: now.toISOString() }],
    orderBy: "nextLifecycleCheckAt",
    direction: "asc",
    limit,
    maxLimit: 250,
  });
  const result = { checked: page.data.length, updated: 0, warnings: 0, expired: 0 };
  for (const record of page.data) {
    try {
      const previousStatus = record.subscriptionStatus;
      const snapshot = subscriptionSnapshot(record, now);
      if (WARNING_DAYS.includes(snapshot.daysRemaining) && snapshot.leadCreationAllowed) {
        if (await sendExpiryWarning(snapshot, snapshot.daysRemaining)) result.warnings += 1;
      }
      snapshot.nextLifecycleCheckAt = nextLifecycleCheckAt(snapshot, now);
      snapshot.lifecycleCheckedAt = now.toISOString();
      await upsertRecord(SUBSCRIPTION_COLLECTION, snapshot.dealershipId, storedSubscriptionRecord(snapshot));
      if (snapshot.subscriptionStatus !== previousStatus) {
        result.updated += 1;
        if (snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED) result.expired += 1;
        await syncSubscriptionSummary(snapshot);
        publishSubscription(
          snapshot,
          { role: "system", email: "subscription-lifecycle" },
          snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED
            ? REALTIME_EVENTS.SUBSCRIPTION_EXPIRED
            : REALTIME_EVENTS.SUBSCRIPTION_UPDATED,
        );
        if (snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED) {
          const expiredAction = record.entitlementType === "TRIAL"
            ? AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_ENDED
            : AUDIT_ACTIONS.SUBSCRIPTION_EXPIRED;
          await writeAuditLog({
            actorId: "subscription-lifecycle",
            actorRole: "system",
            actionType: expiredAction,
            targetEntity: "subscription",
            targetId: snapshot.dealershipId,
            oldValue: { status: previousStatus },
            newValue: { status: snapshot.subscriptionStatus },
            meta: {
              dealershipId: snapshot.dealershipId,
              entitlementEndDate: snapshot.entitlementEndDate,
            },
          });
        }
      }
    } catch (error) {
      logError("Subscription lifecycle processing failed", {
        dealershipId: record.dealershipId || record.id,
        error: error.message,
      });
    }
  }
  logInfo("Subscription lifecycle processed", result);
  return result;
}
