import { upsertRecord } from "./firestore.service.js";
import { REALTIME_EVENTS } from "./realtime.service.js";
import {
  addDays,
  cleanId,
  nextLifecycleCheckAt,
  SUBSCRIPTION_PLAN,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { getDealershipSubscription } from "./subscriptionLifecycle.service.js";
import {
  publishSubscription,
  storedSubscriptionRecord,
  SUBSCRIPTION_COLLECTION,
  syncSubscriptionSummary,
} from "./subscriptionShared.service.js";

async function applyAdminSubscriptionPatch(dealershipId, patch, actor = null, eventType = REALTIME_EVENTS.SUBSCRIPTION_UPDATED) {
  const id = cleanId(dealershipId);
  const current = await getDealershipSubscription(id);
  if (!current) {
    const error = new Error("Subscription not found");
    error.status = 404;
    throw error;
  }
  const next = subscriptionSnapshot({ ...current, ...patch, updatedAt: new Date().toISOString() });
  next.nextLifecycleCheckAt = nextLifecycleCheckAt(next);
  await upsertRecord(SUBSCRIPTION_COLLECTION, id, storedSubscriptionRecord(next));
  await syncSubscriptionSummary(next);
  publishSubscription(next, actor, eventType);
  return next;
}

export async function extendSubscriptionManually({ dealershipId, days, reason, actor = null }) {
  const extensionDays = Math.min(Math.max(Number(days || 0), 1), 3650);
  const current = await getDealershipSubscription(dealershipId);
  const now = new Date();
  const base = current?.entitlementEndDate && new Date(current.entitlementEndDate) > now
    ? current.entitlementEndDate
    : now.toISOString();
  return applyAdminSubscriptionPatch(dealershipId, {
    subscriptionStartDate: current?.subscriptionStartDate || now.toISOString(),
    subscriptionEndDate: addDays(base, extensionDays),
    paymentStatus: current?.paymentStatus === "PAID" ? "PAID" : "MANUAL",
    adminSuspended: false,
    manualExtensionReason: String(reason || "Manual extension by Super Admin").trim(),
    manualExtensionDays: extensionDays,
    lastAdminOverrideAt: now.toISOString(),
    warningDaysSent: [],
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_EXTENDED);
}

export async function activateTrialManually({ dealershipId, days = SUBSCRIPTION_PLAN.trialDays, reason, actor = null }) {
  const trialDays = Math.min(Math.max(Number(days || 0), 1), 365);
  const now = new Date().toISOString();
  return applyAdminSubscriptionPatch(dealershipId, {
    trialStartDate: now,
    trialEndDate: addDays(now, trialDays),
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    paymentStatus: "NOT_PAID",
    adminSuspended: false,
    manualTrialReason: String(reason || "Trial activated by Super Admin").trim(),
    lastAdminOverrideAt: now,
    warningDaysSent: [],
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_TRIAL_STARTED);
}

export async function suspendSubscription({ dealershipId, reason, actor = null }) {
  return applyAdminSubscriptionPatch(dealershipId, {
    adminSuspended: true,
    suspensionReason: String(reason || "Suspended by Super Admin").trim(),
    suspendedAt: new Date().toISOString(),
    suspendedBy: actor?.email || actor?.uid || "super-admin",
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_EXPIRED);
}
