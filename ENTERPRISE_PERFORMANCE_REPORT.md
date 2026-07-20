# CarLoanSaathi Enterprise Performance Report

Generated: 2026-07-14

## Executive certification

**Overall status: YELLOW — strong application architecture and local capacity, with staging Firestore and infrastructure load certification still required.**

The platform already uses bounded cursor queries, role projections, request-local read caching, optional Redis/BullMQ, compressed responses, authenticated SSE invalidations, frontend request coalescing, and operational read/write telemetry. This hardening pass removed the remaining bank-analytics aggregate regression, bounded the process cache, corrected stale cache-tag retention, and added cached, in-flight-deduplicated bank analytics with cursor-bounded executive metrics.

No authentication, authorization, permission, workflow, or SSE architecture was changed.

## Audit scope and baseline

- 153 API routes inventoried.
- Baseline static API audit: 119 low, 28 medium, 6 high-risk routes.
- Firestore index audit: all 22 required index contracts passed.
- Baseline read-reduction model:
  - workflow logs: estimated 650 reads before projection, 1 after;
  - bank source loading: estimated 1,500 reads before projection, 1 after.
- The live read verifier encountered Firestore query timeouts, so those two values are architecture estimates, not production measurements.
- Frontend bundle baseline: React 288.2 KB, Firebase Auth 192.75 KB, application entry 66.36 KB, runtime 56.77 KB. Route-level code splitting remains active.

## Implemented optimizations

### Bank analytics

- Retained maintained aggregate collections; no live lead scan was introduced.
- Added a 15-second identity- and cursor-scoped cache with shared in-flight promises.
- Parallelized independent recent-case and executive-metric reads.
- Parallelized independent transactional summary/executive document reads.
- Added bounded executive pagination: default 20, maximum 50, cursor based.
- Preserved every existing response field and added `executivePerformance` and `executivePagination`.

Expected warm-request effect: aggregate Firestore reads fall to zero within the TTL on a single instance, or across instances when Redis cache is enabled. Cold requests remain bounded to summary candidate resolution plus at most 10 recent cases and 20 executive metrics by default.

### Memory cache

- Added a configurable 5,000-entry process-cache ceiling.
- Added expired-entry pruning.
- Added least-recently-used refresh and oldest-entry eviction.
- Fixed stale tag references when a cache key is overwritten.
- Exposed eviction and configured-capacity metrics through `cacheStats()`.
- Redis cache behavior and invalidation semantics remain unchanged.

## Local production-scale benchmark

Execution mode: isolated process memory and loopback HTTP; production data was not touched.

Dataset:

- 500 dealerships
- 5,000 executives
- 100,000 leads
- 25 concurrent HTTP requests
- 500 SSE clients

Results:

| Measurement | Average | p95 | p99 |
|---|---:|---:|---:|
| Lead creation | 28.301 ms | 38.888 ms | 40.265 ms |
| Lead search over loopback fallback | 368.459 ms | 418.955 ms | 449.894 ms |
| Dashboard over loopback fallback | 470.582 ms | 509.969 ms | 512.383 ms |
| Direct lead search service | 6.326 ms | 6.954 ms | 7.420 ms |
| Direct dashboard service | 13.433 ms | 13.946 ms | 23.610 ms |
| SSE propagation to 500 clients | 0.263 ms | 0.446 ms | 1.046 ms |

The loopback HTTP search/dashboard numbers are dominated by the deliberately unindexed 100,000-row memory fallback. Production must use indexed Firestore and must not treat memory fallback as a capacity mode. The direct-service results satisfy the requested sub-150 ms API target locally; managed Firestore/network latency is not represented.

## Firestore read and write analysis

### Reads

- Tenant lead pages request `limit + 1`; an 8-row page has an estimated read amplification of 1.125.
- Exact case lookup has estimated amplification of 1.0.
- Role dashboards prefer projections and aggregate metrics.
- Request-local caching suppresses repeated identical reads inside one request.
- Shared TTL caching suppresses repeated dashboard/analytics work across requests.
- Missing composite indexes fail in production instead of silently performing broad scans.

### Writes

- Aggregate and projection writes remain synchronized with canonical mutations.
- Bulk rebuilds use Firestore BulkWriter.
- Analytics state changes update only affected summary/executive/state/recent-case documents.
- This pass did not defer correctness-critical writes or weaken consistency to improve latency.

## Duplicate request and query analysis

- Frontend GET requests use shared in-flight promises and cache keys scoped by API, query, portal, and authenticated account.
- Backend TTL-cached loaders share one promise per key.
- Request-local Firestore reads use canonical signatures and report duplicate reads.
- Razorpay, WhatsApp, notification, and SSE paths retain their existing idempotency/deduplication controls.
- Mutating APIs were not globally coalesced because HTTP request equality is not a safe idempotency guarantee. Business mutations require domain idempotency keys or transactions, not process-local suppression.

## Cache analysis

| Cache | Isolation | Bound/invalidation |
|---|---|---|
| Frontend Axios GET cache | API + query + portal + account | 180 entries, TTL/stale windows, mutation/SSE invalidation |
| Request Firestore cache | Async request scope | Released with request |
| Backend process TTL cache | Domain key | 5,000 entries, TTL, LRU eviction, tag invalidation |
| Redis cache | Configured namespace | TTL and distributed tag invalidation |
| SSE event dedupe | Event identity | Bounded TTL registry |

## Memory and CPU analysis

- Benchmark seed heap after loading 100,000 leads: 137.29 MB.
- Backend cache growth is now explicitly bounded.
- SSE connections and event buffers expose health statistics and bounded dedupe state.
- No new timers, polling loops, listeners, or unbounded browser caches were introduced.
- CPU-heavy local fallback sorting/searching remains unsuitable for production; indexed Firestore is mandatory.

## Network, upload, and download analysis

- Express gzip compression is enabled above a configurable threshold.
- Lead and projection queries support field selection and bounded payloads.
- Frontend routes and Firebase capabilities are code-split.
- Uploads already use resumable Firebase upload tasks with progress callbacks.
- Documents are served through short-lived signed URLs and list responses omit active download URLs.
- Chunk/resume behavior beyond Firebase's resumable SDK and HTTP range behavior was not changed because doing so would require a storage protocol/API change.

## Frontend rendering and startup

- Dashboard routes are lazy loaded.
- Large operational lists have a shared virtual-table component available.
- Dashboard hooks hydrate from scoped cached data and retain rows during refresh.
- Realtime uses patch-first invalidation and bounded refresh debouncing.
- React and Firebase Auth remain the largest shared chunks; further reduction requires dependency/runtime changes rather than safe local refactoring.

## SSE performance

- 500 clients and 100 events produced 50,000 local deliveries.
- Local p95 propagation was 0.446 ms.
- Duplicate backend connections are replaced per authenticated identity.
- Client leader election prevents duplicate connections for the same identity across tabs.
- Multi-instance production requires Redis realtime pub/sub and a staging proxy-buffer/reconnect-storm test.

## Security verification

- Authentication and portal isolation were unchanged.
- Authorization audit passed.
- Production invariant suite passed all 25 checks.
- Firestore and Storage rules remain default-deny.
- Rate limiting, App Check, tenant scoping, JWT checks, SSE tickets, and audit logging remain enforced.

## Estimated monthly Firestore cost and savings

Exact currency cost cannot be certified without production traffic, regional Firebase pricing, cache hit rate, and deployed read-meter exports. Use:

`monthly read cost = monthly billed reads / pricing unit × regional unit price`

For bank analytics, if `R` requests occur inside each 15-second cache window, the warm-read reduction is approximately `(R - 1) / R`. Examples: 10 requests per window yields about 90% fewer aggregate reads; 100 yields about 99%. With multi-instance Redis disabled, apply that estimate independently per backend instance.

The projection model's workflow-log estimate reduces 650 reads to approximately 1 per request, while projected bank source loading reduces an estimated 1,500 to approximately 1. These savings require completed projection backfills and healthy freshness monitoring.

## Before versus after

| Area | Before | After |
|---|---|---|
| Production invariants | 24 pass, bank analytics fail | 25/25 pass |
| Bank analytics repeated requests | Aggregate reads on each request | 15-second deduplicated cache |
| Executive analytics | Missing bounded API pagination | Cursor pagination, 20 default/50 max |
| Independent analytics reads | Sequential | Parallel |
| Transaction aggregate reads | Sequential loops | Parallel read groups |
| Process cache | No global entry bound | 5,000-entry configurable ceiling |
| Expired cache entries | Removed only on access | Pruned during writes/stats |
| Overwritten cache tags | Could retain stale references | Replaced atomically |

## Scalability assessment

| Concurrent-user range | Assessment |
|---|---|
| 100–500 | Supported by local benchmark architecture |
| 1,000 | Reasonable with indexed Firestore, healthy projections, and monitoring |
| 5,000 | Requires Redis cache/queue/realtime, multiple backend instances, and staging load proof |
| 10,000 | Requires capacity planning, Firestore quota validation, autoscaling and proxy/SSE certification |

## Scores

- Optimization score: **88/100**
- Performance architecture score: **90/100**
- Scalability score: **82/100**
- Security preservation score: **95/100**

## Remaining risks and required production gates

1. Run k6 against dedicated staging with realistic authenticated accounts and indexed Firestore.
2. Export read-meter data for at least one representative business week before publishing cost savings.
3. Confirm projection backfills and freshness health before traffic migration.
4. Enable Redis cache, queue, and realtime pub/sub for multi-instance scale.
5. Validate Render proxy buffering, SSE reconnect storms, Firestore quota behavior, and p95/p99 latency.

**Certification: YELLOW.** The codebase is materially hardened and suitable for controlled production deployment, but a claim of 5,000–10,000 concurrent-user readiness requires deployed staging evidence rather than local-memory extrapolation.
