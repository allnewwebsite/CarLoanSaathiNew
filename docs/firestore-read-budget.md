# Firestore Read Budget

Targets are for the normal operating profile: 1 dealership, 1 bank branch, 1 GM, 1 finance desk, 1 bank manager, and 1-3 loan executives.

| API / Action | Target Reads | Primary Source | Notes |
| --- | ---: | --- | --- |
| Dealer leads page | <= 15 | `financeViews` | Projection-first, paginated. |
| Finance dashboard | <= 20 | metrics + `financeViews` | Metrics document for counts, projection for recent rows. |
| GM leads page | <= 15 | `gmViews` | Projection-first, paginated. |
| GM dashboard | <= 20 | metrics + `gmViews` | Avoid lead scans. |
| Bank manager leads page | <= 15 | `bankViews` | Projection-first, then existing branch access filter. |
| Loan executive leads page | <= 15 | `executiveViews` | Projection-first, paginated. |
| Admin leads page | <= 20 | `adminViews` | Projection-first, paginated. |
| Lead detail page | <= 10 | lead detail + document queries | Live source read is allowed for authorization/detail correctness. |
| Lead status update | <= 5 | `leads` + projections | Source update plus projection sync and cache invalidation. |
| Customer document upload | <= 10 | `leads`, `documents` | Upload workflow preserved. |
| Bank document upload | <= 10 | `leads`, `bankDocuments` | Upload workflow preserved. |
| Notifications open | <= 10 | role view projection | Projection-first notification reads. |
| Timeline open | <= 10 | `timelineProjection` | Fallback only for legacy/backfill gaps. |
| Workflow logs | <= 15 | `workflowLogViews` | Avoid multi-collection fallback during normal operation. |
| Account login lookup | <= 10 | identity cache + role profile | Identity resolved once, duplicate reads eliminated per request. |
| Restore session | <= 8 | identity cache + profile | No portal scans. |

Use `npm run report:read-meter -- <jsonl-log-file>` against exported production logs containing `READ-METER` entries to compare real traffic against this budget.
