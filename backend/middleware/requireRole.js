import { AUDIT_ACTIONS, queueAuditLog } from "../services/audit.service.js";
import { observeAuthFailure } from "../services/observability.service.js";

function recordUnauthorizedAccess(req, reason, allowedRoles = []) {
  queueAuditLog({
    req,
    actionType: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS,
    actorId: req?.user?.email || req?.user?.uid || "anonymous",
    actorRole: req?.user?.role || "anonymous",
    targetEntity: "route",
    targetId: req?.originalUrl || req?.path || "",
    meta: {
      reason,
      method: req?.method || "",
      route: req?.originalUrl || req?.path || "",
      allowedRoles,
      actualRole: req?.user?.role || null,
      sourcePortal: req?.headers?.["x-source-portal"] || null,
    },
  });
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.user || {};
    if (!user.role) {
      observeAuthFailure(req, "role_required");
      recordUnauthorizedAccess(req, "role_required", allowedRoles);
      return res.status(403).json({ message: "Unauthorized", code: "ROLE_REQUIRED" });
    }
    if (user.approved !== true || user.active === false || user.accountApproved === false || user.accountActive === false) {
      observeAuthFailure(req, "account_not_active");
      recordUnauthorizedAccess(req, "account_not_active", allowedRoles);
      return res.status(403).json({ message: "Unauthorized", code: "ACCOUNT_NOT_ACTIVE" });
    }
    if (!allowedRoles.length || allowedRoles.includes(user.role)) return next();
    observeAuthFailure(req, "role_forbidden");
    recordUnauthorizedAccess(req, "role_forbidden", allowedRoles);
    return res.status(403).json({ message: "Unauthorized", code: "ROLE_FORBIDDEN" });
  };
}
