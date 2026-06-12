# CarLoanSaathi Enterprise Governance Architecture

## Purpose

This document defines the production operating model for CarLoanSaathi across notification delivery, audit/compliance, API standards, security governance, operational limits, and monitoring. It is designed for the existing React/Vite, Express, Firebase Auth, Firestore, Firebase Storage, Vercel, and Render architecture.

## 1. Notification Architecture

### Current Implementation

- `backend/services/notification.service.js` persists notifications and notification logs.
- `backend/services/eventBus.service.js` provides an in-process domain event bus.
- `emitNotificationEvent()` decouples API execution from notification creation.
- WhatsApp delivery remains queue-ready through `whatsappQueue`.

### Standard Notification Schema

```js
{
  id,
  recipientId,
  userId,
  role,
  recipientRole,
  notificationType,
  type,
  title,
  message,
  entityType,
  entityId,
  leadId,
  caseId,
  dealershipId,
  bankId,
  assignedExecutiveId,
  priority, // critical | high | medium | low
  read,
  readAt,
  deliveryStatus, // queued | delivered | failed | dead-lettered
  retryCount,
  maxRetries,
  source,
  requestId,
  expiresAt,
  createdAt
}
```

### Event Types

- `lead-assigned`
- `status-updated`
- `pending-documents`
- `approval`
- `rejection`
- `disbursed`
- `dealer-approved`
- `bank-approved`
- `executive-assigned`
- `system-alert`

### Retry and Dead-Letter Strategy

- Default retries: `NOTIFICATION_MAX_RETRIES` or `5`.
- Backoff starts at `NOTIFICATION_RETRY_BASE_MS`.
- Failed delivery attempts stay queryable in `notificationLogs`.
- Future queue engines should use the same schema with BullMQ, Firebase Functions, or Cloud Tasks.
- Dead-letter storage target: `notificationDeadLetters`.

### Cleanup and TTL

- Default notification TTL: `NOTIFICATION_TTL_DAYS` or `90`.
- Cleanup worker should archive/read-delete old low-priority notifications.
- Critical and audit-linked notifications should be archived before deletion.

## 2. Audit Logging Architecture

### Collections

- `auditLogs`: business actions.
- `authAuditLogs`: login/logout/password reset events.
- `documentAuditLogs`: document access and upload events.

### Standard Audit Schema

```js
{
  action,
  actionType,
  actorId,
  actorRole,
  targetEntity,
  targetId,
  previousValue,
  oldValue,
  newValue,
  dealershipId,
  bankId,
  assignedExecutiveId,
  leadId,
  caseId,
  ipAddress,
  userAgent,
  requestId,
  sourcePortal,
  immutable,
  meta,
  createdAt
}
```

### Immutability

- Firestore client writes to audit collections are denied.
- Backend Admin SDK writes audit records.
- Frontend users can only read audit data through admin-safe APIs/rules.
- Sensitive fields are masked before writing.

### Retention

- Online retention: `AUDIT_ONLINE_RETENTION_DAYS` or `365`.
- Archive retention: `AUDIT_ARCHIVE_RETENTION_DAYS` or `2555`.
- Archive target: `archivedAuditLogs`.

## 3. API Standards

### Request Correlation

- Every request receives `X-Request-Id`.
- Backend attaches `req.requestId` and `res.locals.requestId`.
- Slow requests are logged with duration and route.

### Success Response Standard

```js
{
  success: true,
  message,
  data,
  meta: {
    requestId,
    durationMs
  }
}
```

### Error Response Standard

```js
{
  success: false,
  errorCode,
  message,
  details,
  requestId
}
```

### Pagination Standard

```js
{
  success: true,
  data: [],
  pagination: {
    nextCursor,
    hasMore,
    limit
  }
}
```

Controllers can migrate incrementally to `res.success()` while legacy response compatibility remains intact.

## 4. Security Governance

### RBAC Matrix

Defined in `backend/config/governance.js`.

- `super-admin`: all permissions.
- `finance-desk`: own dealership lead creation, document upload, salesperson management.
- `gm`: own dealership read-only monitoring.
- `bank-manager`: own bank monitoring and executive management.
- `loan-executive`: assigned lead/document/status access.

### Tenant Isolation

Every query must scope by one of:

- `dealershipId`
- `bankId`
- `assignedExecutiveId`
- `super-admin`

No API should load all tenant data and filter only in the frontend.

### Upload Governance

- Max file size: `MAX_UPLOAD_BYTES` or `10 MB`.
- Allowed MIME types: PDF, JPEG, PNG.
- Future malware scanner integration should sit before Storage finalization.
- Public file URLs are not allowed for customer documents.

### App Check Governance

Rollout plan:

1. Enable monitor mode.
2. Add production domains.
3. Verify legitimate traffic.
4. Enforce Firestore/Storage.

## 5. Operational Limits

Defined in `backend/config/governance.js`.

- JSON body size: `API_JSON_LIMIT`, default `2mb`.
- Default page limit: `20`.
- Max page limit: `100`.
- Request timeout target: `25s`.
- Slow request threshold: `2s`.
- Notification retries: `5`.
- Notification TTL: `90 days`.
- Audit online retention: `365 days`.

## 6. Monitoring Integration Points

- `requestId` appears in API responses and logs.
- Slow requests emit structured warnings.
- Notification logs track delivery outcomes.
- Audit logs track critical actions.
- `/health` reports uptime and memory.

## 7. Migration-Safe Rollout Plan

1. Keep existing controller responses.
2. Adopt `res.success()` in new/modified controllers.
3. Replace list-all Firestore reads with scoped `queryRecords`.
4. Move notification delivery to a real queue when volume grows.
5. Add App Check in monitor mode.
6. Add CI checks: build, security scan, dependency audit.
7. Add admin audit export page.
8. Add archive workers for audit, notification, and closed leads.
