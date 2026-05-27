# CarLoanSaathi Production Operations Runbook

## Load Testing

Use k6 scripts in `load-tests/k6`.

### Profiles

- `PROFILE=light`: regular verification.
- `PROFILE=medium`: expected dealership traffic.
- `PROFILE=heavy`: scaling validation.
- `PROFILE=burst`: spike simulation.
- `PROFILE=soak`: memory leak and long-run stability.

### Commands

```powershell
k6 run -e BASE_URL=https://carloansaathi-apkaapnasaathi.onrender.com -e PROFILE=light load-tests/k6/api-smoke.js
k6 run -e BASE_URL=https://carloansaathi-apkaapnasaathi.onrender.com -e AUTH_TOKEN=TOKEN -e PROFILE=medium load-tests/k6/dashboard-load.js
```

Lead creation tests must run only against staging unless `CREATE_LEADS=true` is intentionally set.

## Monitoring

### Render Backend

Required:

```text
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Health endpoints:

```text
/health
/health/queues
```

Alert thresholds:

- p95 API latency above 2 seconds for 10 minutes.
- Error rate above 2 percent for 5 minutes.
- Queue failed jobs above 10 in 15 minutes.
- Memory above 80 percent of Render instance for 10 minutes.

### Vercel Frontend

Required:

```text
VITE_SENTRY_DSN=
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Track:

- frontend crashes
- login failures
- route load errors
- API network failures

## Redis Queue Rollout

1. Provision managed Redis.
2. Add `REDIS_URL` in Render.
3. Deploy.
4. Verify:

```text
GET /health/queues
```

5. Watch Sentry/logs for worker failures.

Queue ownership:

- `notifications`: in-app notification persistence/delivery.
- `metrics-aggregation`: analytics events.
- `archival-jobs`: lead archival.
- `cleanup-jobs`: notification cleanup.
- `whatsapp-jobs`: WhatsApp queue processing.

## Scheduled Operations

Enable only after manual maintenance scripts pass:

```text
ENABLE_SCHEDULED_OPERATIONS=true
```

Intervals:

```text
NOTIFICATION_CLEANUP_INTERVAL_MS=21600000
ARCHIVAL_INTERVAL_MS=86400000
METRICS_INTEGRITY_INTERVAL_MS=3600000
```

Manual commands:

```powershell
npm --prefix backend run maintenance
$env:MAINTENANCE_MODE="archive"; npm --prefix backend run maintenance
$env:MAINTENANCE_MODE="metrics"; npm --prefix backend run maintenance
```

## Historical Metrics Backfill

Dry run:

```powershell
npm --prefix backend run backfill:metrics
```

Apply:

```powershell
$env:BACKFILL_APPLY="true"; npm --prefix backend run backfill:metrics
```

Safety rules:

- Run during low-traffic hours.
- Start with `BACKFILL_BATCH_SIZE=100`.
- Verify metrics in Super Admin before increasing batch size.

## Disaster Recovery

### Firestore

Backup strategy:

- Enable scheduled Firestore exports to Google Cloud Storage.
- Keep daily exports for 30 days.
- Keep monthly exports for 12 months.
- Export before schema/rules changes.

Recovery:

1. Disable writes by putting backend into maintenance mode.
2. Restore Firestore export into recovery project.
3. Validate users, leads, documents, metrics, audit logs.
4. Point staging backend to recovery project.
5. Promote when verified.

### Firebase Storage

- Customer documents are private.
- Backup bucket should use lifecycle rules and restricted IAM.
- Never make document buckets public.

### Redis

Redis is disposable for most jobs because canonical state is Firestore.

Recovery:

- Restart workers.
- Re-enqueue failed operations from `notificationLogs`, `operationalMetrics`, and archival logs.
- Run metrics integrity and backfill if event loss is suspected.

### Credential Compromise

1. Revoke leaked key/API token.
2. Rotate Firebase service account key.
3. Rotate JWT secret.
4. Force logout by invalidating sessions.
5. Review `authAuditLogs` and `auditLogs`.

## Degraded Mode

If Redis is down:

- Backend falls back to in-process async work.
- Critical lead creation still works.
- Queue latency alerts should fire.

If Sentry is down:

- Structured logs continue in Render.

If Firestore quota is near limit:

- Disable noncritical scheduled jobs.
- Reduce dashboard refresh.
- Pause load tests.

## Incident Response

Severity levels:

- SEV1: login down, lead creation down, cross-tenant data risk.
- SEV2: dashboard degraded, queue backlog high, document upload failures.
- SEV3: analytics stale, notification delays, noncritical reports.

Communication template:

```text
Incident:
Impact:
Start time:
Current status:
Next update:
Owner:
```
