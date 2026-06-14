export const ONBOARDING_PLANS = Object.freeze({
  TRIAL: "TRIAL",
  PROFESSIONAL: "PROFESSIONAL",
});

export function normalizeOnboardingPlan(value, fallback = ONBOARDING_PLANS.TRIAL) {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.values(ONBOARDING_PLANS).includes(normalized) ? normalized : fallback;
}

export function isProfessionalPlan(value) {
  return normalizeOnboardingPlan(value) === ONBOARDING_PLANS.PROFESSIONAL;
}
