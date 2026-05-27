# CarLoanSaathi Enterprise Load Testing

This suite uses k6 to benchmark backend APIs, Firebase auth, Firestore query paths, queues, uploads, and real dealership-bank workflows.

## Safety Rules

- Do not run heavy tests against production.
- Use a separate staging Render service, staging Vercel site, and staging Firebase project.
- Write scenarios require `ALLOW_WRITES=true` and should only run on staging.
- Production smoke tests require `ALLOW_PRODUCTION_LOAD=true` and should use `PROFILE=smoke`.

## Install

Install k6 locally:

```powershell
winget install k6
```

## Staging Environment Variables

```powershell
$env:TEST_ENV="staging"
$env:BASE_URL="https://your-staging-backend.onrender.com"
$env:FRONTEND_URL="https://your-staging-frontend.vercel.app"
$env:FIREBASE_WEB_API_KEY="your-staging-web-api-key"
$env:FINANCE_EMAIL="finance-load@demo.local"
$env:FINANCE_PASSWORD="strong-password"
$env:GM_EMAIL="gm-load@demo.local"
$env:GM_PASSWORD="strong-password"
$env:BANK_MANAGER_EMAIL="manager-load@demo.local"
$env:BANK_MANAGER_PASSWORD="strong-password"
$env:EXECUTIVE_EMAIL="exec-load@demo.local"
$env:EXECUTIVE_PASSWORD="strong-password"
$env:ADMIN_EMAIL="admin-load@demo.local"
$env:ADMIN_PASSWORD="strong-password"
```

## Synthetic Data

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

## Test Suites

Smoke:

```powershell
npm run load:smoke
```

Auth:

```powershell
$env:PROFILE="medium"
npm run load:auth
```

Dashboards:

```powershell
$env:PROFILE="medium"
npm run load:dashboard
```

Lead workflow read-only:

```powershell
$env:PROFILE="medium"
npm run load:leads
```

Lead creation on staging only:

```powershell
$env:ALLOW_WRITES="true"
$env:CREATE_LEADS="true"
npm run load:leads
```

Firestore indexed-query stress:

```powershell
$env:PROFILE="heavy"
npm run load:firestore
```

Queue and notification stress:

```powershell
$env:PROFILE="heavy"
npm run load:queue
```

Upload stress on staging only:

```powershell
$env:ALLOW_WRITES="true"
$env:LEAD_ID="CLS-LT-0000001"
npm run load:upload
```

## Output

Every run writes a JSON summary to `load-tests/results/<RUN_ID>-summary.json`.

Summarize local runs:

```powershell
npm run load:report
```

Use the generated p50/p95/p99 values with Render metrics, Sentry traces, Firebase usage, and `/health/queues` to determine real safe capacity.
