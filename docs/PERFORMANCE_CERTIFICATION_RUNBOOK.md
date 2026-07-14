# Enterprise Performance Certification Runbook

The performance certificate is evidence-driven and fails closed. It does not infer staging capacity from local benchmarks.

## 1. Capture staging load evidence

Use a dedicated staging backend, frontend, Firebase project, realistic portal accounts, deployed Firestore indexes, and Redis. Run the auth, dashboard, Firestore, queue, and SSE-relevant workloads described in `load-tests/README.md`. Keep their k6 JSON summaries in one directory.

The gate rejects recent runs when the failed-request rate is at least 2%, p95 is at least 2.5 seconds, p99 is at least 5 seconds, or a k6 threshold failed. Evidence is 14 days old by default.

## 2. Export a representative read-meter window

Export backend JSON logs containing `READ-METER` events for at least seven continuous business days. Verify the window:

```powershell
npm run report:read-meter -- C:\evidence\read-meter.jsonl
```

Events must retain a parseable `timestamp`, `time`, `generatedAt`, `createdAt`, or `loggedAt` field.

## 3. Certify projection state

First run and verify the Phase 1 projection backfill using the existing dry-run/apply procedure. Then sample deployed projection freshness and write the evidence file:

```powershell
npm run report:projection-freshness -- --backfill-complete --output=C:\evidence\projection-freshness.json
```

`--backfill-complete` is an explicit operator attestation; do not pass it until the backfill completed successfully. The command returns non-zero if no records were checked, stale rows remain, or rebuilds were queued. Freshness validation may queue self-healing rebuilds for stale projections.

## 4. Enable distributed runtime services

For more than one backend instance, configure `REDIS_URL` and set all three flags to `true`:

- `ENABLE_REDIS_CACHE`
- `ENABLE_REDIS_QUEUE`
- `ENABLE_REALTIME_REDIS`

The Render blueprint declares these variables without embedding credentials or silently enabling a service that has not been provisioned.

## 5. Issue the certificate

Run the strict gate with the same production configuration that will be deployed:

```powershell
$env:PERFORMANCE_K6_RESULTS_DIR="C:\evidence\k6"
$env:PERFORMANCE_READ_METER_LOG="C:\evidence\read-meter.jsonl"
$env:PROJECTION_FRESHNESS_REPORT="C:\evidence\projection-freshness.json"
$env:REDIS_URL="rediss://configured-by-secret-manager"
$env:ENABLE_REDIS_CACHE="true"
$env:ENABLE_REDIS_QUEUE="true"
$env:ENABLE_REALTIME_REDIS="true"
$env:PERFORMANCE_CERTIFICATION_OUTPUT="C:\evidence\performance-certificate.json"
npm run certify:performance:strict
```

Outcomes:

- `GREEN`: every deployment gate passed with current evidence.
- `YELLOW`: evidence is missing but no supplied evidence failed (non-strict mode).
- `RED`: supplied evidence or required distributed configuration failed.

Use `npm run certify:performance` during evidence collection. CI or a release pipeline must use the strict command and block deployment on its non-zero exit code.
