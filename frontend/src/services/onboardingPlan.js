export const ONBOARDING_PLANS = Object.freeze({
  TRIAL: "TRIAL",
  PROFESSIONAL: "PROFESSIONAL",
});

export const SELECTED_PLAN_STORAGE_KEY = "cls_selected_dealership_plan";

export function selectOnboardingPlan(plan) {
  const selectedPlan = Object.values(ONBOARDING_PLANS).includes(plan) ? plan : ONBOARDING_PLANS.TRIAL;
  sessionStorage.setItem(SELECTED_PLAN_STORAGE_KEY, selectedPlan);
  return selectedPlan;
}

export function selectedOnboardingPlan() {
  const stored = sessionStorage.getItem(SELECTED_PLAN_STORAGE_KEY);
  return Object.values(ONBOARDING_PLANS).includes(stored) ? stored : ONBOARDING_PLANS.TRIAL;
}
