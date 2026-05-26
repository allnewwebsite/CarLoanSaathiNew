export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.user || {};
    if (!user.role) return res.status(403).json({ message: "Unauthorized", code: "ROLE_REQUIRED" });
    if (user.approved !== true || user.active === false || user.accountActive === false) {
      return res.status(403).json({ message: "Unauthorized", code: "ACCOUNT_NOT_ACTIVE" });
    }
    if (user.role === "super-admin") return next();
    if (!allowedRoles.length || allowedRoles.includes(user.role)) return next();
    return res.status(403).json({ message: "Unauthorized", code: "ROLE_FORBIDDEN" });
  };
}
