import { queryRecords } from "./firestore.service.js";
import {
  cleanId,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { getDealershipSubscription } from "./subscriptionLifecycle.service.js";

export async function billingHistory(dealershipId, { limit = 25, cursor = null } = {}) {
  const id = cleanId(dealershipId);
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
}

export async function getBillingOverview(dealershipId) {
  const subscription = await getDealershipSubscription(dealershipId);
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
    history: await billingHistory(dealershipId),
  };
}
