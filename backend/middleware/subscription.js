import { assertLeadCreationAllowed } from "../services/subscription.service.js";

export async function requireLeadCreationSubscription(req, res, next) {
  try {
    const dealershipId = String(req.user?.dealershipId || req.user?.email || "").trim().toLowerCase();
    if (!dealershipId) {
      return res.status(403).json({
        code: "DEALERSHIP_SCOPE_REQUIRED",
        message: "Dealership scope is required",
      });
    }
    req.subscription = await assertLeadCreationAllowed(dealershipId);
    return next();
  } catch (error) {
    if (error.code === "SUBSCRIPTION_EXPIRED") {
      return res.status(403).json({
        code: error.code,
        errorCode: error.code,
        message: error.message,
        subscription: error.subscription,
      });
    }
    return next(error);
  }
}

