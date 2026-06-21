import {
  getRecord,
  updateRecord,
} from "./firestore.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import {
  cleanId,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { clearCachedTags } from "./ttlCache.service.js";

export const SUBSCRIPTION_COLLECTION = "dealershipSubscriptions";

export function storedSubscriptionRecord(record = {}) {
  const { daysRemaining, ...stored } = record;
  return stored;
}

export async function dealershipRecord(dealershipId) {
  return await getRecord("dealerships", dealershipId).catch(() => null)
    || await getRecord("approvedDealerships", dealershipId).catch(() => null)
    || await getRecord("dealers", dealershipId).catch(() => null);
}

export async function syncSubscriptionSummary(snapshot) {
  clearCachedTags([`billing:${snapshot.dealershipId}`]);
  const patch = {
    planName: snapshot.planName,
    subscriptionStatus: snapshot.subscriptionStatus,
    trialStartDate: snapshot.trialStartDate || null,
    trialEndDate: snapshot.trialEndDate || null,
    subscriptionStartDate: snapshot.subscriptionStartDate || null,
    subscriptionEndDate: snapshot.subscriptionEndDate || null,
    monthlyAmount: snapshot.monthlyAmount,
    gstAmount: snapshot.gstAmount,
    finalAmount: snapshot.finalAmount,
    lastPaymentDate: snapshot.lastPaymentDate || null,
    nextBillingDate: snapshot.nextBillingDate || null,
    paymentStatus: snapshot.paymentStatus || "NOT_PAID",
    selectedPlan: snapshot.selectedPlan,
    dashboardAccessAllowed: snapshot.dashboardAccessAllowed,
    razorpayOrderId: snapshot.razorpayOrderId || null,
    razorpayPaymentId: snapshot.razorpayPaymentId || null,
    invoiceNumber: snapshot.invoiceNumber || null,
  };
  await Promise.all(["dealerships", "approvedDealerships", "dealers"].map(async (collection) => {
    const existing = await getRecord(collection, snapshot.dealershipId).catch(() => null);
    if (existing) await updateRecord(collection, existing.id, patch).catch(() => null);
  }));
}

export function publishSubscription(snapshot, actor = null, eventType = REALTIME_EVENTS.SUBSCRIPTION_UPDATED) {
  return publishRealtimeEvent({
    eventType,
    actor,
    data: {
      dealershipId: snapshot.dealershipId,
      recipientId: snapshot.financeDeskEmail || snapshot.dealershipId,
      status: snapshot.subscriptionStatus,
      subscription: {
        subscriptionStatus: snapshot.subscriptionStatus,
        daysRemaining: snapshot.daysRemaining,
        trialEndDate: snapshot.trialEndDate,
        subscriptionEndDate: snapshot.subscriptionEndDate,
        leadCreationAllowed: snapshot.leadCreationAllowed,
      },
    },
  });
}

export function normalizeSubscriptionPatch(current, patch) {
  const next = subscriptionSnapshot({ ...current, ...patch, updatedAt: new Date().toISOString() });
  return {
    id: cleanId(next.dealershipId || current?.dealershipId || current?.id),
    snapshot: next,
  };
}
