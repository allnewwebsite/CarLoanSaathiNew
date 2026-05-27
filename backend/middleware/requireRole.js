import { observeAuthFailure } from "../services/observability.service.js";

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.user || {};
    if (!user.role) {
      observeAuthFailure(req, "role_required");
      return res.status(403).json({ message: "Unauthorized", code: "ROLE_REQUIRED" });
    }
    if (user.approved !== true || user.active === false || user.accountActive === false) {
      observeAuthFailure(req, "account_not_active");
      return res.status(403).json({ message: "Unauthorized", code: "ACCOUNT_NOT_ACTIVE" });
    }
    if (user.role === "super-admin") return next();
    if (!allowedRoles.length || allowedRoles.includes(user.role)) return next();
    observeAuthFailure(req, "role_forbidden");
    return res.status(403).json({ message: "Unauthorized", code: "ROLE_FORBIDDEN" });
  };
}
