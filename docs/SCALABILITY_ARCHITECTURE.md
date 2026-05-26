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

- Keep open workflow leads in `leads`.
- Move closed leads older than the retention window to `archivedLeads`.
- Keep analytics counters in metrics documents before archiving.

## Governance Additions

- Every backend request must carry a correlation ID through `X-Request-Id`.
- New APIs should return `{ success, message, data, meta }`.
- Audit collections are immutable from frontend clients; only backend Admin SDK writes them.
- Notifications are persisted first, then delivery work runs asynchronously.
- Queue migration targets: BullMQ/Redis, Firebase Functions, or Cloud Tasks.
- SLA/TAT thresholds live in `backend/config/governance.js` and can later move into Firestore settings.
