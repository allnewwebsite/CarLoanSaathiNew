# CarLoanSaathi Firestore Query Governance

## Production Rules

- Lead reads must always be scoped by at least one identity field:
  - `dealershipId`
  - `bankId`
  - `assignedExecutiveId`
  - `caseId`
- Cursor pagination is mandatory. Do not use offset or page-number skipping.
- Default page size is `20`; hard maximum is `FIRESTORE_MAX_PAGE_SIZE` with a recommended value of `100`.
- Dashboard APIs must use metrics documents for counts and paginated list APIs for rows.
- Analytics APIs must read precomputed metrics only. They must not count or aggregate full lead collections live.
- Use selective DTO fields for lead lists. Full lead documents should be fetched only on detail screens.

## Central Query Layer

The shared query path is:

- `backend/services/firestore.service.js`
- `backend/services/queryGovernance.service.js`
- `backend/services/leadQuery.service.js`

The query layer provides:

- query limit clamping
- cursor-based pagination
- lead tenant-scope enforcement
- query timeout protection
- slow query structured logging
- selective field projection

## Search Strategy

Firestore does not support full-text contains search. Production search must use:

- exact `caseId` query for `CLS-*`
- exact indexed filters for status, bank, city, salesperson id
- future external search engine for fuzzy customer/mobile search at very large scale

Do not scan all leads to search by customer text.

## Index Deployment

Deploy indexes with:

```powershell
firebase deploy --only firestore:indexes
```

Required index groups are maintained in `firestore.indexes.json`:

- leads by dealership/status/salesperson/bank/executive/case/city
- documents by lead
- notifications by recipient/dealership/bank/read
- audit logs by actor/action/role/tenant/lead/case
- lead assignments by lead, status, bank, branch, and executive
- business metrics, operational metrics, alerts, and events

## Hotspot Prevention

- Do not write high-frequency counters directly from request handlers when traffic grows.
- Metrics writes should remain queue-driven.
- If write contention appears on global metrics, move to sharded counters:
  - `metrics/global/shards/{0..N}`
  - aggregate into read model periodically
- Operational events and notifications use random document IDs and are safe for high write distribution.

## Scale Targets

With this query model, operational dashboards stay bounded:

- 1 dashboard page = one metrics doc + one paginated query
- 1 lead table page = 20 to 100 lead reads
- 1 document page = one lead read + one document query
- 1 notification page = one indexed notification query

Recommended production thresholds:

- p95 API latency below 800 ms
- Firestore slow query threshold 1200 ms
- page size 20 to 50 for dashboards
- maximum backend page size 100
- archive closed leads after 180 days

## Future Growth Path

At 1M+ leads:

- keep active `leads` collection limited to open/recent cases
- move closed old cases to `archivedLeads`
- export historical analytics to BigQuery
- add Algolia/Meilisearch/Elastic for fuzzy search
- shard global metrics writes if Sentry shows contention
- run k6 load tests before raising Render worker concurrency
