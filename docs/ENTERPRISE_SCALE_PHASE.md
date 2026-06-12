# CarLoanSaathi Enterprise Scale Phase

## 1. Event-Driven Analytics

The analytics layer now reads from precomputed metrics documents instead of scanning lead collections.

### Metrics Collections

- `metrics`: global metrics.
- `dailyMetrics`: day-level trends.
- `monthlyMetrics`: month-level trends.
- `dealershipMetrics`: dealership scorecards.
- `bankMetrics`: bank scorecards.
- `executiveMetrics`: executive scorecards.
- `operationalMetrics`: queue and system telemetry.

### Update Events

Metrics update when domain events occur:

- lead created
- lead assigned
- status changed

The active implementation uses `analyticsEngine.service.js`. When Redis is enabled, events can be processed through the `metrics-aggregation` queue. Without Redis, the same logic runs through safe in-process fallback.

### Dashboard Rule

Dashboard analytics APIs must read metrics documents only. Do not calculate dashboard KPIs by reading full `leads` collections.

## 2. Queue Infrastructure

The queue layer is optional and Render-compatible.

### Required Environment Variable

```text
REDIS_URL=
```

If `REDIS_URL` is not present, the app falls back to local async processing and does not crash.

### Queues

- `notifications`
- `archival-jobs`
- `metrics-aggregation`
- `email-jobs`
- `whatsapp-jobs`
- `cleanup-jobs`

### Retry Policy

- Attempts: `QUEUE_MAX_ATTEMPTS` or `5`.
- Backoff: exponential.
- Failed jobs are retained for operational inspection.

### Health

```text
GET /health/queues
```

## 3. Sentry Monitoring

### Backend

Set:

```text
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Backend errors are captured from the global error handler with request correlation IDs.

### Frontend

Set in Vercel:

```text
VITE_SENTRY_DSN=
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE=0.1
```

The React error boundary reports crashes without changing UI.

## 4. Table Virtualization

`VirtualTable.jsx` now uses `react-window` and supports large tables with viewport rendering, sticky headers, row memoization, and reduced memory pressure.

Future table migrations should use this component for:

- lead tables
- notifications
- audit logs
- analytics tables

## 5. Archival and Retention

Closed leads can be archived from `leads` to `archivedLeads` through `archival.service.js`.

Default behavior is rollback-safe:

- Copy lead to `archivedLeads`.
- Mark source lead as `archiveReady`.
- Do not delete source unless `ARCHIVE_DELETE_SOURCE=true`.

### Environment Variables

```text
LEAD_ARCHIVE_AFTER_DAYS=180
ARCHIVAL_BATCH_SIZE=50
ARCHIVE_DELETE_SOURCE=false
```

### Cleanup

Expired notifications are marked cleanup-ready first. Physical deletion should be enabled only after backup/archive validation.

## 6. Migration-Safe Rollout

1. Deploy code with no Redis/Sentry first.
2. Verify current portals.
3. Add Sentry DSNs.
4. Add Redis and verify `/health/queues`.
5. Schedule archival jobs after metrics are validated.
6. Migrate large tables one portal at a time to `VirtualTable`.
7. Deploy Firestore indexes.
8. Backfill historical metrics with a one-time worker before relying on historical dashboards.

## 7. Remaining Roadmap

- One-time historical metrics backfill.
- Queue dashboard for Super Admin.
- Archive search APIs.
- App Check enforcement.
- Firestore TTL policies for low-risk notification cleanup.
- Alerting for queue failures, slow API calls, and realtime delivery failures.

## 8. Operational Validation

Operational procedures live in `docs/PRODUCTION_OPERATIONS_RUNBOOK.md`.

Before increasing traffic:

1. Run k6 smoke tests.
2. Run dashboard load test with an authenticated token.
3. Run metrics backfill dry-run.
4. Run backend maintenance in dry/copy-first mode.
5. Verify `/health/queues`.
6. Verify Sentry frontend/backend event delivery.
