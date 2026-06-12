# Enterprise Load Testing Playbook

## Objective

CarLoanSaathi capacity claims must be proven with staged, repeatable, production-safe k6 tests. The test suite measures API latency, Firebase Auth behavior, Firestore indexed-query performance, dashboard hydration, queue pressure, upload throughput, and workflow degradation.

## Required Staging Architecture

- Staging Render backend with production-like environment variables.
- Staging Vercel frontend.
- Staging Firebase project with separate Auth, Firestore, and Storage.
- Staging Redis instance when queue benchmarks are enabled.
- Synthetic users for `finance-desk`, `gm`, `bank-manager`, `loan-executive`, and `super-admin`.
- Synthetic leads tagged with `loadTest: true`.

Do not run write or heavy tests against production. Production is limited to smoke checks only.

## k6 Suites

| Suite | Script | Purpose |
| --- | --- | --- |
| Smoke | `load-tests/k6/api-smoke.js` | Health, queue health, public catalog latency |
| Auth | `load-tests/k6/auth-load.js` | Firebase email/password login, backend role validation, session validation |
| Dashboard | `load-tests/k6/dashboard-load.js` | Role-specific dashboard and list API load |
| Workflow | `load-tests/k6/lead-workflow.js` | Lead listing, optional lead creation, optional status update |
| Firestore | `load-tests/k6/firestore-stress.js` | Indexed tenant-scoped lead queries, metrics reads, case search |
| Queue | `load-tests/k6/queue-stress.js` | Queue health, notification reads, optional queue drain |
| Upload | `load-tests/k6/upload-load.js` | Staging-only document upload throughput |

## Profiles

- `smoke`: 1 VU sanity test.
- `light`: 10 concurrent users.
- `medium`: 50 concurrent users.
- `heavy`: 150 concurrent users.
- `enterprise`: staged 500 to 1,000 concurrent users.
- `stress`: ramps to saturation.
- `soak`: long-running stability check.

Run enterprise and stress only after light/medium/heavy pass.

## Core Commands

```powershell
$env:TEST_ENV="staging"
$env:BASE_URL="https://your-staging-backend.onrender.com"
$env:FIREBASE_WEB_API_KEY="your-staging-web-api-key"
$env:PROFILE="medium"
npm run load:dashboard
```

Write tests require:

```powershell
$env:ALLOW_WRITES="true"
```

Production smoke requires:

```powershell
$env:ALLOW_PRODUCTION_LOAD="true"
$env:PROFILE="smoke"
npm run load:smoke
```

## Synthetic Data Plan

Use `backend/scripts/seedLoadTestData.js`.

Dry run:

```powershell
npm run load:seed
```

Seed staging:

```powershell
$env:LOAD_TEST_ENV="staging"
$env:LOAD_TEST_SEED_APPLY="true"
$env:LOAD_TEST_LEAD_COUNT="100000"
npm run load:seed
```

For 500k to 1M lead tests, run in chunks and monitor Firebase writes, index build status, Render memory, and Sentry errors.

## Metrics To Capture

- k6: p50, p95, p99, request rate, failed request rate, checks.
- Render: CPU, memory, restart count, HTTP latency.
- Firebase: Firestore read/write count, index errors, quota pressure, Auth request failures.
- Redis/BullMQ: waiting, active, failed, delayed jobs, retry counts.
- Sentry: backend errors, frontend errors, slow transactions, release regressions.
- Health endpoints: `/health`, `/health/deep`, `/health/queues`, `/health/observability`.

## Pass/Fail Thresholds

| Area | Target |
| --- | --- |
| API p95 | under 2 seconds |
| API p99 | under 4 seconds |
| Dashboard p95 | under 2.5 seconds |
| Auth p95 | under 2.5 seconds |
| Upload p95 | under 5 seconds |
| Failed request rate | under 2 percent |
| Queue backlog | drains after burst without manual action |
| Render memory | below 80 percent sustained |
| Firestore errors | zero permission/index/quota errors |

## Capacity Validation Method

1. Seed 100k staging leads.
2. Run smoke, auth, dashboard, Firestore, queue at `light`.
3. Repeat at `medium`.
4. Repeat at `heavy`.
5. Seed 500k leads and repeat dashboard + Firestore.
6. Seed 1M leads and repeat indexed-query and metrics tests.
7. Run workflow write tests with `ALLOW_WRITES=true`.
8. Run upload tests with a known staging `LEAD_ID`.
9. Run soak test overnight only after all short tests pass.
10. Create a scorecard from generated summaries and hosting/Firebase metrics.

## Capacity Scorecard Template

| Test | Users | p50 | p95 | p99 | Error Rate | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Auth medium | 50 |  |  |  |  |  |
| Dashboard heavy | 150 |  |  |  |  |  |
| Firestore heavy | 150 |  |  |  |  |  |
| Workflow medium | 50 |  |  |  |  |  |
| Queue burst | 100 |  |  |  |  |  |
| Upload light | 10 |  |  |  |  |  |

## Production Safety

- Never set `ALLOW_WRITES=true` against production.
- Never run `PROFILE=heavy`, `enterprise`, `stress`, or `soak` against production.
- Use a fresh Firebase staging project for high-volume seed tests.
- Delete or archive staging load-test data after benchmark cycles.
- Pause tests immediately if Firebase quota warnings, 5xx rates, Render restarts, or queue failures spike.

## Final Readiness Interpretation

- If `medium` passes but `heavy` fails: safe MVP production, upgrade Render/Redis before enterprise onboarding.
- If `heavy` passes with 100k leads: safe for regional dealership traffic.
- If `enterprise` passes with 500k to 1M leads: ready for large multi-tenant bank/dealer traffic, subject to cost review.
- If Firestore indexed tests fail: add indexes or refactor query before increasing traffic.
