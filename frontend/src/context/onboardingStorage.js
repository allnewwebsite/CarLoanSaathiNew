const ONBOARDING_LOCAL_PREFIX = "cls_onboarding_seen";

export function onboardingIdentityKey(user = {}) {
  const role = String(user?.role || "").trim().toLowerCase();
  const identity = String(user?.uid || user?.email || "").trim().toLowerCase();
  return role && identity ? `${ONBOARDING_LOCAL_PREFIX}:${role}:${identity}` : "";
}

export function readLocalOnboardingSeen(user) {
  const key = onboardingIdentityKey(user);
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function markLocalOnboardingSeen(user) {
  const key = onboardingIdentityKey(user);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, "true");
  } catch {
    // Product tour history is a convenience only.
  }
}
