import { requireRole as requireExistingRole } from "./requireRole.js";

export function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return requireExistingRole(...allowed);
}

export function requireOwnership(assertOwner) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "super-admin") return next();
      const allowed = await assertOwner(req);
      if (!allowed) return res.status(403).json({ message: "Unauthorized", code: "OWNERSHIP_REQUIRED" });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
