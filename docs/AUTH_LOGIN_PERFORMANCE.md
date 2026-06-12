# Auth Login Performance Audit

## Scope

Endpoint: `POST /api/auth/login`

The successful login response now waits only for:

1. Firebase password authentication when email/password is supplied.
2. Firebase ID token verification.
3. Canonical user identity and portal authorization.
4. Parent dealership validation for dealer/finance roles.
5. One `userSessions` document write.

Analytics, notifications, dashboards, WhatsApp, Twilio, Redis, queues, monitoring
data, and presentation-profile collections are not loaded by the successful
login path.

## Before

Normal successful login performed:

- 2-4 `users` identity reads.
- 1 canonical-user write plus 1 readback.
- A second canonical-user write plus 1 readback to clear failed-login state.
- Up to 25 `userSessions` reads before creating the session.
- 1-8 dealership/bank/profile presentation reads.
- 1 login activity write before responding.
- Firebase Admin user lookup and custom-claim write on every login.
- Optional password-lifecycle write plus readback.

Estimated normal Firestore cost: 8-38 reads, 4-6 writes.

Observed latency supplied for the audit: 5-10 seconds.

## After

Synchronous response path:

- Bank/admin: 2 parallel direct `users` reads and 1 session write.
- Dealer/finance: 2 parallel direct `users` reads, normally 1 dealership read,
  and 1 session write.
- No collection scan.
- No analytics, notification, dashboard, Twilio, WhatsApp, Redis, or monitoring
  call.

Deferred maintenance:

- Login activity write.
- Firebase custom-claim repair only when claims differ.
- Password-lifecycle persistence only when fields are missing.
- Failed-login reset only when stale failure state exists.
- Concurrent-session cleanup reads at most
  `MAX_CONCURRENT_SESSIONS + 1` active sessions.

Estimated synchronous Firestore cost: 2-3 reads and 1 write.

Estimated warm-instance response:

- Existing Firebase ID token: 100-350 ms.
- Backend email/password authentication: 250-800 ms.
- Cold Render instance or cross-region Firebase latency can exceed these ranges.

Production acceptance remains:

- P95 below 500 ms.
- P99 below 1000 ms.

Use `load-tests/k6/auth-load.js` against a warm production instance to verify
the percentiles. The backend success log now includes total duration and
Firebase, identity, and session-write phase timings.

## Required Deployment

Deploy `firestore.indexes.json` before enabling the bounded active-session
cleanup query in production.
