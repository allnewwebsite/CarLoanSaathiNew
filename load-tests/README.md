# CarLoanSaathi Load Testing

Use k6 for production-like API load testing without committing credentials.

## Install

Install k6 locally from https://k6.io/docs/get-started/installation/

## Smoke Test

```powershell
k6 run -e BASE_URL=https://carloansaathi-apkaapnasaathi.onrender.com load-tests/k6/api-smoke.js
```

## Authenticated Dashboard Test

Generate a short-lived auth token manually from the browser/session, then run:

```powershell
k6 run -e BASE_URL=https://carloansaathi-apkaapnasaathi.onrender.com -e AUTH_TOKEN=YOUR_TOKEN -e PROFILE=light load-tests/k6/dashboard-load.js
```

## Lead Workflow Test

Default mode only reads lists. Lead creation is disabled unless explicitly enabled.

```powershell
k6 run -e BASE_URL=https://carloansaathi-apkaapnasaathi.onrender.com -e AUTH_TOKEN=YOUR_TOKEN -e PROFILE=medium load-tests/k6/lead-workflow.js
```

To test lead creation against a staging project only:

```powershell
k6 run -e BASE_URL=https://staging-api.example.com -e AUTH_TOKEN=YOUR_TOKEN -e CREATE_LEADS=true load-tests/k6/lead-workflow.js
```

## Thresholds

- API p95 under 2 seconds.
- Error rate under 2 percent.
- No production lead-create stress unless staging data is isolated.
