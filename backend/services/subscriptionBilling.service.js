import { queryRecords } from "./firestore.service.js";
import {
  cleanId,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { getDealershipSubscription } from "./subscriptionLifecycle.service.js";
import { cached } from "./ttlCache.service.js";

const BILLING_CACHE_TTL_MS = Number(process.env.BILLING_OVERVIEW_CACHE_TTL_MS || 30000);

export async function billingHistory(dealershipId, { limit = 25, cursor = null } = {}) {
  const id = cleanId(dealershipId);
  const cacheKey = `billing:history:${id}:${JSON.stringify({ limit, cursor: cursor || "" })}`;
  return cached(cacheKey, BILLING_CACHE_TTL_MS, async () => {
    const [payments, invoices] = await Promise.all([
      queryRecords("subscriptionPayments", {
        where: [{ field: "dealershipId", value: id }],
        orderBy: "paidAt",
        direction: "desc",
        limit,
        maxLimit: 50,
        cursor,
      }),
      queryRecords("subscriptionInvoices", {
        where: [{ field: "dealershipId", value: id }],
        orderBy: "paymentDate",
        direction: "desc",
        limit,
        maxLimit: 50,
        cursor,
      }),
    ]);
    return {
      payments: payments.data,
      invoices: invoices.data,
      nextCursor: payments.nextCursor || invoices.nextCursor || null,
    };
  }, { tags: [`billing:${id}`] });
}

export async function getBillingOverview(dealershipId) {
  const id = cleanId(dealershipId);
  return cached(`billing:overview:${id}`, BILLING_CACHE_TTL_MS, async () => {
    const subscription = await getDealershipSubscription(id);
    if (!subscription) {
      const error = new Error("Subscription not found");
      error.status = 404;
      throw error;
    }
    return {
      plan: {
        ...SUBSCRIPTION_PLAN,
        ...subscriptionAmounts(),
      },
      subscription: subscriptionSnapshot(subscription),
      history: await billingHistory(id),
    };
  }, { tags: [`billing:${id}`] });
}
