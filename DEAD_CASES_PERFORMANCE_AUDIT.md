# Dead Cases Performance Audit

## Certification

**GREEN — Dead Cases now consumes the existing portal-scoped prefetch cache on its first render, keeps cached rows visible, and refreshes silently without changing permissions or workflow behavior.**

## Request trace

```text
Sidebar hover/focus/pointer-down or dashboard idle
  -> prefetchDashboardRoute
  -> portal-specific GET /dead-cases?page=1&limit=20
  -> identity-scoped Axios cache
  -> Dead Cases route mount
  -> synchronous cached-row hydration
  -> immediate table paint
  -> silent coalesced/background refresh
  -> indexed Firestore query when cache requires network refresh
```

## Root cause

Dead Cases already had route-level prefetch for Finance Desk, GM, Bank Manager, and Loan Executive. The shared API cache was also portal/account scoped and supported stale-while-revalidate. However, `useDeadCasesPageState` always initialized with an empty row array and `loading=true`. It did not read the prefetched cache.

As a result, navigating to Dead Cases painted an empty table/skeleton and waited for an asynchronous Axios resolution even when the response was already available locally. Other list modules synchronously hydrate their initial state from the same cache, which explains the visible difference.

## Frontend optimization

- The hook now reads the exact prefetched key before initializing React state.
- Cached rows and pagination state are rendered on the first paint.
- The mount refresh is silent when cache exists.
- Existing rows remain visible during later filter, page, mutation, and realtime reconciliation requests.
- Existing request coalescing prevents duplicate identical GET requests.
- Realtime events continue to patch inserted, updated, and restored dead cases without a full blocking reload.

## Firestore and backend audit

- Queries use `isDeadCase == true` plus role scope (`dealershipId`, `bankId`, executive identity, or salesperson identity).
- Results are ordered by `deadCaseDate desc`, cursor paginated, and limited to 20 by the UI and 100 maximum by the service.
- Composite indexes exist for global, dealership, bank, executive, and salesperson dead-case paths.
- No full collection scan, offset pagination, N+1 lookup, repeated aggregation, or client-side global dataset filtering was found.
- Backend authorization and Finance-Desk-only mutation rules remain unchanged.

## Cache behavior

| Condition | Before | After |
|---|---|---|
| Prefetch cache hit | Empty initial rows, loading state, async hydration | Cached rows on first render |
| Background refresh | Could present initial skeleton | Silent with existing rows retained |
| Identical concurrent GET | Coalesced | Coalesced |
| Portal/account isolation | Scoped | Scoped and unchanged |
| Realtime change | Patch-first | Patch-first and unchanged |

## Measurable impact

- Cache-hit request-to-visible-data wait: reduced from at least one asynchronous interceptor/promise/render cycle to synchronous React state initialization.
- Cache-hit blocking network requests: zero before and after; the visible delay was cache consumption, not transport.
- Duplicate identical requests: zero through the existing in-flight request coalescer.
- Firestore reads on a valid frontend cache hit: zero.
- Page query upper bound: 20 rows requested by the frontend, 100 enforced maximum in the backend.
- Network payload and backend processing are unchanged on cache misses because the existing query was already bounded and indexed.

Exact production milliseconds depend on device, Render wake state, and network conditions. No unsupported latency number is claimed from local static analysis.

## Portal coverage

- Finance Desk: `/dealer/dead-cases`
- GM: `/gm/dead-cases`
- Bank Manager: `/bank/dead-cases`
- Loan Executive: `/bank/dead-cases`, with executive identity filtering
- Super Admin: no Dead Cases route exists; the router intentionally redirects that path to Admin Leads. This audit did not add a feature or change permissions.

## Scalability

The visible table cost remains bounded by page size rather than total collection size. Firestore performs indexed cursor queries, while React maps only the current page. Therefore 100, 1,000, 10,000, or 100,000 total dead cases do not increase per-page render complexity or response size, assuming declared indexes are deployed.

## Files modified

- `frontend/src/pages/dashboard/deadCases.hooks.js`
- `backend/tests/deadCaseContracts.test.js`
- `DEAD_CASES_PERFORMANCE_AUDIT.md`

## Validation criteria

- Cached data reused: PASS
- Silent background refresh: PASS
- No first-paint loader on cache hit: PASS
- No duplicate identical GET: PASS
- Indexed, bounded Firestore access: PASS
- Realtime patch behavior preserved: PASS
- Authorization and business logic unchanged: PASS
