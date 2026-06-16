# CarLoanSaathi Architecture

CarLoanSaathi is an operational finance platform for dealerships, GMs, bank managers, loan executives, and super admins. The backend is the authority for all business workflows; the frontend does not write Firestore directly for dashboard operations.

## Runtime Shape

- Frontend: React, Vite, Tailwind, React Router, Axios, Firebase Auth.
- Backend: Express, Firebase Admin, Firestore, JWT sessions, optional Redis/BullMQ, Razorpay billing.
- Database: Firestore, accessed through backend services and security rules.
- Realtime: authenticated Server-Sent Events used as invalidation signals.

## Request Flow

1. Browser signs in or registers through Firebase where needed.
2. Backend validates identity and issues a portal-scoped JWT session.
3. Frontend API calls include the backend JWT and `X-CLS-Portal`.
4. Backend auth resolves the canonical Firestore identity and tenant scope.
5. Controllers call services for validation, mutation, projection sync, audit, timeline, notification, metrics, billing, and realtime side effects.

## Canonical Collections

These collections represent source-of-truth business data:

- `users`
- `dealerships`
- `approvedDealerships`
- `pendingDealershipApprovals`
- `banks`
- `pendingBankApprovals`
- `loanExecutives`
- `salespersons`
- `financeManagers`
- `leads`
- `documents`
- `bankDocuments`
- `leadTimeline`
- `notifications`
- `dealershipSubscriptions`
- `subscriptionOrders`
- `subscriptionPayments`
- `subscriptionInvoices`

Backend-owned audit and operational collections include `auditLogs`, `authAuditLogs`, `documentAuditLogs`, `operationalMetrics`, `operationalEvents`, `operationalAlerts`, `whatsappQueue`, and billing reconciliation health collections.

## Projection Collections

Role dashboards should prefer projection collections where available:

- `adminViews`
- `financeViews`
- `gmViews`
- `bankViews`
- `executiveViews`
- `leadDetailsProjection`
- `timelineProjection`
- `staffViewProjection`
- `salespersonSummaryProjection`
- `executiveSummaryProjection`
- `bankDealershipViews`

Projection records must carry freshness metadata such as `projectionVersion`, `projectionUpdatedAt`, `sourceCollection`, `sourceId`, and `sourceUpdatedAt`. Scheduled projection freshness validation records its last run in health state and should be treated as a production signal.

## Mutation Side Effects

Lead and account mutations can trigger several side effects:

- projection sync or removal
- audit log writes
- timeline events
- notifications
- WhatsApp queue events
- analytics and metrics updates
- bank analytics aggregate updates
- SSE invalidation events
- subscription entitlement checks

When changing a workflow, audit all affected side effects. A change is incomplete if it updates canonical data but leaves projections, audit, notifications, or realtime stale.

## Access Model

Every authenticated route is scoped by role and portal:

- `finance-desk`: dealership operations and lead creation.
- `gm`: dealership monitoring.
- `bank-manager`: bank branch management and reassignment.
- `loan-executive`: assigned lead processing.
- `super-admin`: platform administration.

Do not add unscoped lead reads. Lead list APIs must include one of `dealershipId`, `bankId`, `assignedExecutiveId`, or a direct `caseId` lookup unless the route is explicitly super-admin only.

## Frontend Boundaries

Dashboard pages should be split into:

- route shell
- data hooks
- table row builders
- form helpers
- detail panels

Large dashboard files should be reduced incrementally. Start by extracting pure helpers and hooks, then move screens one route at a time.

## Operational Checks

Before production deployment:

- Run `npm test`.
- Run `npm run security:scan`.
- Run `npm run security:authz-audit`.
- Build the frontend with `npm --prefix frontend run build`.
- Deploy Firestore rules and indexes.
- Check `/health/deep` and Admin Monitoring after deploy.
