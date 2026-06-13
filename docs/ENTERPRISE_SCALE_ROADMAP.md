# CarLoanSaathi Enterprise Scale Roadmap

## Query Architecture

All high-volume lead APIs must use cursor-based Firestore queries through `backend/services/leadQuery.service.js`.

Required scope order:

1. `dealershipId`
2. `bankId`
3. `assignedExecutiveId`
4. `status`
5. `createdAt`

Never load the full `leads` collection for dashboard pages. Super Admin APIs must use cursor pagination and lightweight projections.

## Lead Retention

- Active and archived workflows stay in `leads`.
- Rejected leads archive after 90 days and disbursed leads after 180 days.
- Archiving removes active projections/counters while preserving historical metrics.
- Documents remain in private Storage paths and metadata remains queryable.

## Async Notifications

Notification APIs now have three layers:

- `notificationEvents`: queue-ready event persistence.
- `notifications`: user-facing in-app records.
- `notificationLogs`: delivery/read/audit tracking.

The current Render process can run the worker loop. At larger scale, move the same event schema to BullMQ/Redis, Cloud Tasks, or Firebase Functions.

## Metrics Engine

Metrics services use Firestore count aggregation where available. Dashboard count cards should move to:

- `metrics/lead:global:global`
- `metrics/lead:dealership:{dealershipId}`
- `metrics/lead:bank:{bankId}`
- `metrics/lead:executive:{assignedExecutiveId}`

This keeps dashboard reads cheap even with high lead volume.

## App Check Rollout

1. Add `VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY` in Vercel.
2. Add debug token only for local development.
3. Enable App Check monitor mode for Firestore and Storage.
4. Watch failure logs.
5. Enforce once legitimate traffic is clean.

## Monitoring

- Every API request has `X-Request-Id`.
- Slow requests are logged as structured JSON.
- Queue failures are logged with event IDs.
- Frontend errors are captured through `ErrorBoundary` and `monitoring.js`.
- Add Sentry DSNs later without changing app flow.

## Production Thresholds

- API p95 latency target: under 800 ms.
- Slow request warning: 2 seconds.
- Max page size: 100.
- Notification retries: 5.
- Upload limit: 10 MB.
- Audit online retention: 365 days.
