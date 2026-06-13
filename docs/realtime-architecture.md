# CarLoanSaathi Realtime Synchronization

CarLoanSaathi uses authenticated Server-Sent Events (SSE) as the only dashboard
realtime transport. Business data remains behind the existing RBAC-protected,
paginated APIs; SSE events are invalidation signals that tell mounted views when
to reload their authorized API scope.

## Event Rules

- The browser opens one authenticated SSE connection for the active session.
- Events contain identifiers and change metadata, not complete business records.
- Mounted views refresh only when an event matches their role, lead, case, or API
  scope.
- Backend APIs remain authoritative for dealership, branch, city, assignment,
  and role filtering.
- Mutations also emit a local invalidation event so the initiating tab converges
  immediately.

## Lifecycle Governance

- The SSE client reconnects with bounded backoff after a disconnect.
- Connection recovery and browser online recovery invalidate mounted views once.
- Background tabs defer refreshes and reconcile when visible again.
- Refresh callbacks are deduplicated without sharing or overwriting view state.
- Logout closes the active stream and clears session-scoped data.
- Role mismatches render an isolated access-denied state and never switch portals
  automatically.

## Cost Controls

- There are no client Firestore snapshot listeners.
- There are no dashboard or session polling intervals.
- Existing paginated APIs remain the source of truth.
- Event bursts are debounced before API refresh.
- Monitoring reports repeated API failures and SSE disconnect storms.

## Operational Behavior

SSE invalidations refresh dashboards, lead tables, notification badges, document
views, timelines, and bank-executive lifecycle views without changing existing
workflows. If the stream temporarily disconnects, bounded reconnection plus an
online or visibility recovery refresh reconciles stale views through the backend
API.
