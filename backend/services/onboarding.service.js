import { findIdentityCandidates, clearIdentityCaches } from "./identity.service.js";
import { getRecord, updateRecord, upsertRecord } from "./firestore.service.js";

const ONBOARDING_ROLES = new Set(["finance-desk", "gm", "bank-manager", "loan-executive"]);

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function accountIds(user = {}, account = {}) {
  return unique([
    account.id,
    account.uid,
    user.uid,
    account.email,
    user.email,
  ]);
}

export function supportsOnboarding(role = "") {
  return ONBOARDING_ROLES.has(String(role || "").trim().toLowerCase());
}

export function onboardingStatusForUser(user = {}, account = {}) {
  const role = account.role || user.role || "";
  const completed = account.onboardingCompleted === true || user.onboardingCompleted === true;
  return {
    supported: supportsOnboarding(role),
    role,
    onboardingCompleted: completed,
    onboardingCompletedAt: account.onboardingCompletedAt || user.onboardingCompletedAt || null,
    onboardingSkipped: account.onboardingSkipped === true || user.onboardingSkipped === true,
    showOnboarding: supportsOnboarding(role)
      && completed !== true
      && user.firstLoginRequired !== true
      && user.passwordExpired !== true
      && user.dashboardAccessAllowed !== false
      && user.accountActive !== false
      && user.accountApproved !== false,
  };
}

async function findExistingUserDocument(user = {}, account = {}) {
  for (const id of accountIds(user, account)) {
    const record = await getRecord("users", id).catch(() => null);
    if (record) return record;
  }
  return null;
}

export async function completeUserOnboarding({ user = {}, account = {}, skipped = false } = {}) {
  const role = account.role || user.role || "";
  if (!supportsOnboarding(role)) {
    const error = new Error("Onboarding is not configured for this role.");
    error.status = 400;
    error.code = "ONBOARDING_UNSUPPORTED_ROLE";
    throw error;
  }
  const email = normalizeEmail(account.email || user.email);
  const now = new Date().toISOString();
  const patch = {
    onboardingCompleted: true,
    onboardingCompletedAt: now,
    onboardingSkipped: Boolean(skipped),
    onboardingLastAction: skipped ? "skipped" : "completed",
  };
  const existing = await findExistingUserDocument(user, account);
  if (existing?.id) {
    await updateRecord("users", existing.id, patch, { readback: false });
  } else {
    const id = String(account.uid || user.uid || email || "").trim();
    await upsertRecord("users", id, {
      uid: id,
      email,
      role,
      ...patch,
    }, { readback: false });
  }
  clearIdentityCaches({ uid: account.uid || user.uid, email });
  return { ...patch };
}

export async function resetUserOnboarding({ userId = "", email = "" } = {}) {
  const normalizedEmail = normalizeEmail(email || userId);
  const candidates = await findIdentityCandidates({ uid: userId, email: normalizedEmail });
  const target = candidates.find((item) => supportsOnboarding(item.role))
    || candidates[0]
    || await getRecord("users", userId).catch(() => null)
    || await getRecord("users", normalizedEmail).catch(() => null);
  if (!target?.id) {
    const error = new Error("User not found for onboarding reset.");
    error.status = 404;
    error.code = "ONBOARDING_USER_NOT_FOUND";
    throw error;
  }
  await updateRecord("users", target.id, {
    onboardingCompleted: false,
    onboardingCompletedAt: null,
    onboardingSkipped: false,
    onboardingResetAt: new Date().toISOString(),
  }, { readback: false });
  clearIdentityCaches({ uid: target.uid || target.id, email: target.email || normalizedEmail });
  return { reset: true, userId: target.id, email: target.email || normalizedEmail };
}
