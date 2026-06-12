# CarLoanSaathi Production Observability Runbook

## Activation

Backend monitoring is enabled by setting these Render environment variables:

- `SENTRY_DSN`
- `SENTRY_TRACES_SAMPLE_RATE=0.1`
- `SENTRY_PROFILES_SAMPLE_RATE=0`
- `ALERT_SLOW_API_MS=2000`
- `ALERT_CRITICAL_API_MS=5000`
- `ALERT_QUEUE_FAILED_JOBS=10`
- `ALERT_QUEUE_BACKLOG_JOBS=250`
- `ALERT_MEMORY_RSS_MB=450`

Frontend monitoring is enabled by setting these Vercel environment variables:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_TRACES_SAMPLE_RATE=0.1`
- `VITE_SENTRY_REPLAY_SAMPLE_RATE=0`
- `VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE=0.1`
- `VITE_APP_ENV=production`
- `VITE_APP_RELEASE`

Sentry must use separate projects for backend and frontend in production.

## Health Endpoints

- `GET /health`
  Lightweight uptime, memory, queue, worker, and environment status.

- `GET /health/deep`
  Deep production checks for Firestore, queue, metrics engine, scheduler, notification worker, and archival status. Returns `503` only when a critical dependency is down.

- `GET /health/queues`
  Queue counts for waiting, active, failed, and delayed jobs.

- `GET /health/observability`
  Combined operational health, recent operational alerts, and recent operational events.

Use `/health` for Render uptime checks and `/health/deep` for internal operational checks.

## Alert Severity

- `critical`: Full outage, data loss risk, auth down, Firestore unavailable.
- `high`: Repeated API failures, queue failures above threshold, worker crash, Redis outage with large backlog.
- `medium`: Slow APIs, rising queue backlog, scheduler degradation, or delayed notification processing.
- `low`: Informational degradation, maintenance events, local fallback mode.

## Alert Routing Readiness

The platform records alerts in `operationalAlerts` and sends incidents to Sentry when `SENTRY_DSN` exists.

Future routing variables are reserved:

- `ALERT_EMAIL_TO`
- `SLACK_WEBHOOK_URL`
- `ALERT_WHATSAPP_TO`
- `ALERT_SMS_TO`

No WhatsApp/SMS provider is called until those integrations are explicitly implemented.

## Structured Logging

All backend operational logs are JSON and include:

- `level`
- `message`
- `timestamp`
- `service`
- `environment`
- `release`
- `requestId` when available
- endpoint, status code, duration, role, and user id where available

Sensitive values containing password, token, secret, key, authorization, cookie, session, private, or credential are masked before logging.

## Dashboards

Recommended production dashboards:

- API health: request count, status codes, slow endpoint count, p95 latency.
- Queue health: waiting, active, delayed, failed jobs by queue.
- Worker health: last run timestamps for notifications, WhatsApp, archival, metrics, and scheduler.
- Firestore health: deep health latency and failure count.
- Notification health: failed notification events and delivery status.
- Frontend health: crash count, route-level errors, browser performance traces.

Sentry dashboards should be tagged by:

- `environment`
- `release`
- `requestId`
- `component`
- `severity`
- `incident`

## Incident Response

### SEV-1

Examples: API down, Firestore unavailable, auth unavailable, data write failures.

Actions:

1. Check Render service status and `/health/deep`.
2. Check Firebase console service status and quotas.
3. Check Sentry latest critical incidents.
4. If deployment-related, roll back to last known good Render deployment.
5. Freeze noncritical maintenance jobs by setting `ENABLE_SCHEDULED_OPERATIONS=false`.
6. Preserve audit logs and export incident details.

### SEV-2

Examples: queue backlog, Redis outage, notification failures, high 5xx rate.

Actions:

1. Check `/health/queues`.
2. If Redis is down, system continues with local fallback for core API flow.
3. Reduce worker concurrency if CPU/memory is high.
4. Re-run failed queue jobs after Redis recovery.
5. Monitor `operationalAlerts` for repeated alerts.

### SEV-3

Examples: slow dashboards, slow APIs, delayed notifications, or elevated queue latency.

Actions:

1. Review slow API alerts.
2. Check Firestore indexes for the affected query.
3. Validate metrics docs are being read instead of broad lead scans.
4. Run metrics integrity maintenance if dashboards show inconsistent counters.

### SEV-4

Examples: isolated frontend crash, single failed upload, one failed notification.

Actions:

1. Review Sentry issue and requestId.
2. Confirm user role and tenant isolation context.
3. Patch, deploy, and monitor release regression.

## Recovery Checks

After any incident:

1. `/health` returns `status: ok`.
2. `/health/deep` returns `status: ok` or documented noncritical degraded state.
3. Queue failed counts are below alert threshold.
4. No active Sentry critical incidents remain.
5. Audit and operational events were written.
6. Dashboard metrics match Firestore data after backfill/integrity check.

## Governance

- Do not log raw Firebase tokens, passwords, private keys, cookies, or service account fields.
- Do not expose `/health/observability` publicly in dashboards without admin protection in a future admin route.
- Keep Sentry replay text masking enabled.
- Keep scheduled jobs disabled by default until production thresholds are confirmed.
- Review alert thresholds monthly after real traffic baselines are known.
