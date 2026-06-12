# Bank Analytics Scaling

## Runtime Data Sources

`GET /api/bank/analytics` does not read `leads` or portal lead projections.

- `bankAnalyticsSummaries`: one summary document per bank branch.
- `bankExecutiveAnalytics`: paginated executive metrics for the branch.
- `bankRecentCases`: the ten most recent case activities.
- `bankAnalyticsLeadStates`: server-only contribution state used to make updates idempotent.

Every normal lead create, update, reassignment, and delete updates these aggregates. Firestore transactions subtract the previous contribution and add the current contribution, so retries and status changes do not inflate counters.

## Read Estimate

Previous implementation:

- One projection query capped at 250 documents.
- Up to 11 lead-field queries for every bank identity alias.
- Additional multi-field executive and branch lookup queries.
- Typical branch with three identity aliases: roughly 8,500 to 13,000 document reads in the worst populated case.
- Results were still incomplete above 250 matching leads.

Aggregate implementation:

- Summary: 1 document read.
- Recent activity: up to 10 document reads.
- Executive performance: up to 100 document reads per cursor page.
- Typical first page: 12 to 111 reads.
- Lead collection reads: 0.
- Read cost is unchanged whether the branch has 100, 100,000, or 1,000,000 leads.

## Deployment

1. Deploy `firestore.indexes.json` and `firestore.rules`.
2. Run a dry read:

   `npm run backfill:bank-analytics`

3. Apply the one-time migration:

   PowerShell:

   `$env:BANK_ANALYTICS_BACKFILL_APPLY="true"; npm run backfill:bank-analytics`

4. Confirm `aggregateReady: true` from `GET /api/bank/analytics`.

The backfill uses cursor pagination with batches of at most 500 leads and Firestore bulk writes. Runtime analytics never falls back to scanning leads.
