import { hasPermission } from "../config/governance.js";

export function requirePermission(permission) {
  return (req, res, next) => {
    if (hasPermission(req.user?.role, permission)) return next();
    return res.status(403).json({
      success: false,
      errorCode: "PERMISSION_DENIED",
      message: "You are not authorized to perform this action.",
      requestId: req.requestId || null,
    });
  };
}
