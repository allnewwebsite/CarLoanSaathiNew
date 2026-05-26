import { queueAuditLog, AUDIT_ACTIONS } from "../services/audit.service.js";

const auditedRoutes = [
  { method: "POST", pattern: /^\/api\/auth\/login$/, action: AUDIT_ACTIONS.LOGIN, targetEntity: "auth" },
  { method: "POST", pattern: /^\/api\/auth\/logout$/, action: AUDIT_ACTIONS.LOGOUT, targetEntity: "auth" },
  { method: "POST", pattern: /^\/api\/auth\/password-reset\/validate$/, action: AUDIT_ACTIONS.PASSWORD_RESET, targetEntity: "auth" },
  { method: "POST", pattern: /^\/api\/leads/, action: AUDIT_ACTIONS.LEAD_CREATED, targetEntity: "lead" },
  { method: "PATCH", pattern: /^\/api\/leads\/.+\/status$/, action: AUDIT_ACTIONS.STATUS_UPDATED, targetEntity: "lead" },
  { method: "POST", pattern: /^\/api\/documents/, action: AUDIT_ACTIONS.DOCUMENT_UPLOADED, targetEntity: "document" },
];

function matchAuditRoute(req) {
  return auditedRoutes.find((item) => item.method === req.method && item.pattern.test(req.originalUrl));
}

export function auditMiddleware(req, res, next) {
  const matched = matchAuditRoute(req);
  res.on("finish", () => {
    if (!matched) return;
    if (res.statusCode >= 500) return;
    queueAuditLog({
      req,
      actionType: matched.action,
      targetEntity: matched.targetEntity,
      targetId: req.params?.id || req.body?.leadId || req.body?.caseId || null,
      sourcePortal: req.headers["x-source-portal"] || null,
      meta: {
        route: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        requestId: req.requestId,
      },
      collection: matched.targetEntity === "auth" ? "authAuditLogs" : "auditLogs",
    });
  });
  next();
}
