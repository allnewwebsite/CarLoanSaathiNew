# CarLoanSaathi Enterprise Scalability Architecture

## Firestore Query Rules

- Lead list APIs must query by tenant scope first: `dealershipId`, `bankId`, or `assignedExecutiveId`.
- Never load all `leads` and filter in memory for dashboards.
- Use cursor pagination with `nextCursor`; page-number offset queries are not production-safe.
- Keep dashboard count data in metrics documents as traffic grows.

## Required Composite Indexes

- `leads`: `dealershipId desc, createdAt desc`
- `leads`: `bankId desc, createdAt desc`
- `leads`: `assignedExecutiveId desc, createdAt desc`
- `leads`: `status desc, createdAt desc`
- `leads`: `dealershipId desc, status desc, createdAt desc`
- `leads`: `bankId desc, status desc, createdAt desc`
- `notifications`: `dealershipId desc, createdAt desc`
- `notifications`: `bankId desc, createdAt desc`
- `notifications`: `recipientId desc, createdAt desc`

## App Check Rollout

1. Create a reCAPTCHA v3 key for production domains.
2. Add `VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY` in Vercel.
3. Verify reads/writes in monitor mode.
4. Enable Firestore and Storage enforcement only after confirming legitimate traffic.

## Monitoring Rollout

- Use Render logs for backend JSON logs.
- Add Sentry DSNs when ready and wire them through the existing monitoring service abstraction.
- Alert on API latency over `SLOW_REQUEST_MS`.
- Track `/health` for uptime and memory.

## Active/Archived Leads

- Keep all workflow leads in `leads`; archive eligible records in place.
- Mark rejected leads after 90 days and disbursed leads after 180 days with `isArchived`, `archivedAt`, and `archiveReason`.
- Remove archived records from active projections and counters while retaining historical daily/monthly metrics.

## Governance Additions

- Every backend request must carry a correlation ID through `X-Request-Id`.
- New APIs should return `{ success, message, data, meta }`.
- Audit collections are immutable from frontend clients; only backend Admin SDK writes them.
- Notifications are persisted first, then delivery work runs asynchronously.
- Queue migration targets: BullMQ/Redis, Firebase Functions, or Cloud Tasks.

## Enterprise Scale Phase

- Analytics reads must use metrics documents and not live lead aggregation.
- Redis/BullMQ is optional through `REDIS_URL`; local fallback preserves deployment compatibility.
- Sentry is optional through `SENTRY_DSN` and `VITE_SENTRY_DSN`.
- Archive jobs never copy or delete lead records; archived leads are immutable.
- Large tables should migrate to `VirtualTable` from `frontend/src/components/VirtualTable.jsx`.
