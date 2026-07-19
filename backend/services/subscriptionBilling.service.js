import { queryRecords } from "./firestore.service.js";
import {
  cleanId,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { getDealershipSubscription } from "./subscriptionLifecycle.service.js";
import { cached } from "./ttlCache.service.js";
import { logWarn } from "./logger.service.js";

const BILLING_CACHE_TTL_MS = Number(process.env.BILLING_OVERVIEW_CACHE_TTL_MS || 30000);

export async function billingHistory(dealershipId, { limit = 25, cursor = null } = {}) {
  const id = cleanId(dealershipId);
  const cacheKey = `billing:history:${id}:${JSON.stringify({ limit, cursor: cursor || "" })}`;
  return cached(cacheKey, BILLING_CACHE_TTL_MS, async () => {
    const channels = ["payments", "invoices", "failures", "refunds", "orders"];
    const results = await Promise.allSettled([
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
      queryRecords("subscriptionPaymentFailures", {
        where: [{ field: "dealershipId", value: id }],
        orderBy: "failedAt",
        direction: "desc",
        limit,
        maxLimit: 50,
        cursor,
      }),
      queryRecords("subscriptionRefunds", {
        where: [{ field: "dealershipId", value: id }],
        orderBy: "processedAt",
        direction: "desc",
        limit,
        maxLimit: 50,
        cursor,
      }),
      queryRecords("subscriptionOrders", {
        where: [{ field: "dealershipId", value: id }],
        orderBy: "createdAt",
        direction: "desc",
        limit,
        maxLimit: 50,
        cursor,
      }),
    ]);
    const pages = Object.fromEntries(results.map((result, index) => {
      const channel = channels[index];
      if (result.status === "fulfilled") return [channel, result.value];
      logWarn("Billing history channel unavailable", {
        dealershipId: id,
        channel,
        error: result.reason?.code || result.reason?.message || "unknown",
      });
      return [channel, { data: [], nextCursor: null }];
    }));
    const unavailableChannels = results
      .map((result, index) => result.status === "rejected" ? channels[index] : null)
      .filter(Boolean);
    return {
      payments: pages.payments.data,
      invoices: pages.invoices.data,
      failures: pages.failures.data,
      refunds: pages.refunds.data,
      pendingOrders: pages.orders.data.filter((order) => ["CREATED", "PENDING"].includes(order.status)),
      nextCursor: pages.payments.nextCursor || pages.invoices.nextCursor || pages.failures.nextCursor || pages.refunds.nextCursor || pages.orders.nextCursor || null,
      partial: unavailableChannels.length > 0,
      unavailableChannels,
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
