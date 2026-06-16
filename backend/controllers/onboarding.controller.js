import { completeUserOnboarding, onboardingStatusForUser, resetUserOnboarding } from "../services/onboarding.service.js";

export async function getOnboardingStatus(req, res, next) {
  try {
    res.set("Cache-Control", "no-store").json(onboardingStatusForUser(req.user, req.authAccount));
  } catch (error) {
    next(error);
  }
}

export async function completeOnboarding(req, res, next) {
  try {
    const result = await completeUserOnboarding({
      user: req.user,
      account: req.authAccount,
      skipped: req.body?.skipped === true,
    });
    res.set("Cache-Control", "no-store").json({
      ok: true,
      onboardingCompleted: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function resetOnboarding(req, res, next) {
  try {
    const result = await resetUserOnboarding({
      userId: req.body?.userId,
      email: req.body?.email,
    });
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
}
