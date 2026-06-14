import { assertLeadCreationAllowed, getDealershipSubscription } from "../services/subscription.service.js";

export async function requireDashboardSubscription(req, res, next) {
  try {
    const dealershipId = String(req.user?.dealershipId || req.user?.email || "").trim().toLowerCase();
    if (!dealershipId) {
      return res.status(403).json({ code: "DEALERSHIP_SCOPE_REQUIRED", message: "Dealership scope is required" });
    }
    const subscription = await getDealershipSubscription(dealershipId);
    if (!subscription?.dashboardAccessAllowed) {
      return res.status(403).json({
        code: subscription?.subscriptionStatus === "PAYMENT_PENDING" ? "SUBSCRIPTION_PAYMENT_REQUIRED" : "SUBSCRIPTION_EXPIRED",
        message: subscription?.subscriptionStatus === "PAYMENT_PENDING"
          ? "Professional Plan payment is required before dashboard access can be activated."
          : "Your subscription has expired. Renew to restore dashboard access.",
        subscription,
      });
    }
    req.subscription = subscription;
    return next();
  } catch (error) {
    return next(error);
  }
}

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
    if (["SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_PAYMENT_REQUIRED"].includes(error.code)) {
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
