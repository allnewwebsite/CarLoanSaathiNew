import { isProfessionalPlan, normalizeOnboardingPlan, ONBOARDING_PLANS } from "../utils/onboardingPlan.js";

export const SUBSCRIPTION_STATUSES = Object.freeze({
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  EXPIRING_SOON: "EXPIRING_SOON",
  EXPIRED: "EXPIRED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
});

export const SUBSCRIPTION_PLAN = Object.freeze({
  name: "CarLoanSaathi Professional",
  monthlyAmount: 15_000,
  gstRate: Number(process.env.SUBSCRIPTION_GST_RATE || 18),
  billingCycleDays: 30,
  trialDays: 60,
  currency: "INR",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = [7, 3, 1];

export function cleanId(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function latestDate(values = []) {
  const valid = values.map(iso).filter(Boolean).sort();
  return valid.at(-1) || null;
}

export function subscriptionAmounts() {
  const monthlyAmount = SUBSCRIPTION_PLAN.monthlyAmount;
  const gstAmount = Math.round(monthlyAmount * SUBSCRIPTION_PLAN.gstRate / 100);
  return {
    monthlyAmount,
    gstRate: SUBSCRIPTION_PLAN.gstRate,
    gstAmount,
    finalAmount: monthlyAmount + gstAmount,
  };
}

export function subscriptionSnapshot(record = {}, nowValue = new Date()) {
  const now = new Date(nowValue);
  const trialEndDate = iso(record.trialEndDate);
  const subscriptionEndDate = iso(record.subscriptionEndDate);
  const entitlementEndDate = latestDate([trialEndDate, subscriptionEndDate]);
  const remainingMs = entitlementEndDate ? new Date(entitlementEndDate).getTime() - now.getTime() : -1;
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const selectedPlan = normalizeOnboardingPlan(record.selectedPlan);
  const professionalPlan = isProfessionalPlan(selectedPlan);
  const activeEntitlement = Boolean(
    subscriptionEndDate
    && entitlementEndDate === subscriptionEndDate
    && ["PAID", "MANUAL"].includes(String(record.paymentStatus || "").toUpperCase())
  );
  const hadPaidEntitlement = Boolean(subscriptionEndDate || record.lastPaymentDate || record.razorpayPaymentId);
  const paymentPending = professionalPlan && !activeEntitlement && !hadPaidEntitlement && record.adminSuspended !== true;
  const expired = record.adminSuspended === true || (!paymentPending && (!entitlementEndDate || remainingMs <= 0));
  const subscriptionStatus = paymentPending
    ? SUBSCRIPTION_STATUSES.PAYMENT_PENDING
    : expired
    ? SUBSCRIPTION_STATUSES.EXPIRED
    : daysRemaining <= 7
      ? SUBSCRIPTION_STATUSES.EXPIRING_SOON
      : activeEntitlement
        ? SUBSCRIPTION_STATUSES.ACTIVE
        : SUBSCRIPTION_STATUSES.TRIAL;
  const trialRemaining = trialEndDate ? new Date(trialEndDate).getTime() - now.getTime() : -1;

  return {
    ...record,
    selectedPlan,
    planName: SUBSCRIPTION_PLAN.name,
    billingCycleDays: SUBSCRIPTION_PLAN.billingCycleDays,
    renewalType: "MANUAL",
    ...subscriptionAmounts(),
    subscriptionStatus,
    entitlementType: activeEntitlement ? "PAID" : professionalPlan ? "PROFESSIONAL" : "TRIAL",
    entitlementEndDate,
    daysRemaining,
    trialStatus: trialState({ trialEndDate, professionalPlan, trialRemainingMs: trialRemaining }),
    dashboardAccessAllowed: !expired && !paymentPending,
    leadCreationAllowed: !expired && !paymentPending,
    nextBillingDate: subscriptionEndDate,
  };
}

export function nextLifecycleCheckAt(snapshot, nowValue = new Date()) {
  const now = new Date(nowValue);
  const end = snapshot.entitlementEndDate ? new Date(snapshot.entitlementEndDate) : null;
  if (!end || end <= now || snapshot.adminSuspended === true) return addDays(now, 30);
  const warningTargets = WARNING_DAYS
    .map((days) => new Date(end.getTime() - days * DAY_MS))
    .filter((date) => date > now)
    .sort((left, right) => left - right);
  return (warningTargets[0] || end).toISOString();
}

function trialState({ trialEndDate, professionalPlan, trialRemainingMs }) {
  if (professionalPlan) return "NOT_APPLICABLE";
  if (!trialEndDate) return "NOT_STARTED";
  const days = Math.max(0, Math.ceil(trialRemainingMs / DAY_MS));
  if (days <= 0) return "EXPIRED";
  if (days <= 6) return "EXPIRING";
  if (days <= 29) return "WARNING";
  return "ACTIVE";
}

export function baseSubscription({ dealershipId, dealership = {}, trialStartDate, trialDays = SUBSCRIPTION_PLAN.trialDays }) {
  const startedAt = iso(trialStartDate) || new Date().toISOString();
  const snapshot = subscriptionSnapshot({
    id: dealershipId,
    dealershipId,
    dealershipName: dealership.dealershipName || dealership.name || "",
    billingAddress: dealership.address || dealership.fullAddress || "",
    financeDeskEmail: dealership.loginEmail || dealership.email || dealershipId,
    financeDeskMobile: dealership.officialDealershipMobile || dealership.mobile || dealership.ownerMobile || "",
    planName: SUBSCRIPTION_PLAN.name,
    trialStartDate: startedAt,
    trialEndDate: addDays(startedAt, trialDays),
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    paymentStatus: "NOT_PAID",
    selectedPlan: ONBOARDING_PLANS.TRIAL,
    adminSuspended: false,
    warningDaysSent: [],
    createdAt: new Date().toISOString(),
  });
  return {
    ...snapshot,
    nextLifecycleCheckAt: nextLifecycleCheckAt(snapshot),
  };
}

export function professionalPendingSubscription({ dealershipId, dealership = {}, approvedAt }) {
  const createdAt = iso(approvedAt) || new Date().toISOString();
  const snapshot = subscriptionSnapshot({
    id: dealershipId,
    dealershipId,
    dealershipName: dealership.dealershipName || dealership.name || "",
    billingAddress: dealership.address || dealership.fullAddress || "",
    financeDeskEmail: dealership.loginEmail || dealership.email || dealershipId,
    financeDeskMobile: dealership.officialDealershipMobile || dealership.mobile || dealership.ownerMobile || "",
    selectedPlan: ONBOARDING_PLANS.PROFESSIONAL,
    trialStartDate: null,
    trialEndDate: null,
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    paymentStatus: "PENDING",
    adminSuspended: false,
    warningDaysSent: [],
    approvedAt: createdAt,
    createdAt,
  });
  return { ...snapshot, nextLifecycleCheckAt: addDays(createdAt, 30) };
}
