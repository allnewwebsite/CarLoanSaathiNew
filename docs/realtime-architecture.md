# CarLoanSaathi Realtime Synchronization

CarLoanSaathi uses scoped Firestore listeners as invalidation signals and keeps all business reads on the existing RBAC-protected APIs. This preserves pagination, tenant isolation, query governance, and backend branch filtering while removing manual browser refreshes.

## Listener Rules

- Never subscribe to a full `leads` collection.
- Lead table listeners are limited to the visible working set, capped at 50 rows.
- Finance Desk and GM/SM listen only to `leads` for their `dealershipId`.
- Loan Executives listen only to `assignedExecutiveId` and `assignedExecutiveEmail` scoped leads.
- Bank Managers use bank-scoped notification signals, then refresh through `/bank/leads` so backend branch/city governance remains authoritative.
- Super Admin listens to limited `operationalEvents` signals, then refreshes admin APIs.
- Detail pages listen only to the selected lead document and its selected lead document rows.
- Timeline views listen only to the selected lead timeline.

## Lifecycle Governance

All subscriptions go through `frontend/src/services/realtimeManager.js`.

- Subscriptions are keyed and deduplicated.
- Duplicate consumers share one Firestore listener.
- Route changes remove callbacks and close unused listeners.
- Logout tears down all active subscriptions.
- Background tabs defer refreshes and reconcile on visibility resume.
- Listener errors fall back to API reloads.

## Cost Controls

- Every query uses equality scope, `orderBy`, and `limit`.
- No listener scans whole tenant history.
- Existing paginated APIs remain the source of truth.
- Snapshot changes are debounced before API refresh.
- Firestore indexes are defined in `firestore.indexes.json`.

## Operational Behavior

Realtime listeners refresh dashboards, lead tables, notification badges, document views, and timelines without changing existing UI or workflows. If Firestore temporarily disconnects, the next snapshot, browser focus, or visibility resume reconciles the stale state through the backend API.
