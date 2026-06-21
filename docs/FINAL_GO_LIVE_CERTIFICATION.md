# CarLoanSaathi Final Go-Live Certification

Date: 2026-06-21

## Recommendation

Status: YELLOW

The platform is production-buildable and passed the local security, role isolation, realtime, index, regression, lint, test, and bundle checks listed below. No critical production blocker remains in the checked code paths.

Go-live should proceed only after the live staging latency/stress gate is run with deployed Firestore credentials and k6 installed. This local audit could not execute the requested 100 concurrent user stress test because `k6` is not installed in this environment.

## Fixes Applied During Certification

1. Timeline tenant scoping hardened.
   - File: `backend/services/timeline.service.js`
   - The `/api/timeline` fallback list path now explicitly filters every row through `canReadScopedTimeline({ event, lead, actor })` using the enriched authenticated actor.
   - Contract added in `backend/tests/paginationContracts.test.js`.

2. Root-prefix frontend production build fixed.
   - File: `frontend/vite.config.js`
   - Vite now pins `root` to the frontend config directory so `npm --prefix frontend run build` and `cd frontend && npm run build` behave the same.

## Verification Evidence

| Check | Result |
| --- | --- |
| `npm run validate:regression` | PASS, 25 production invariants |
| `npm run security:production-blockers` | PASS, 15 blocker checks |
| `npm run security:authz-audit` | PASS, 35 authorization checks |
| `npm run audit:firestore-indexes` | PASS, 22 required indexes |
| `npm run security:scan` | PASS |
| `node scripts/audit-api-efficiency.js --strict` | PASS, 0 critical lead APIs without projection-first path |
| `npm run test` | PASS, backend 46/46 and frontend 22/22 |
| `npm --prefix frontend run lint` | PASS |
| `npm --prefix frontend run build` | PASS |
| `npm run bundle:report` | PASS with vendor chunk warnings |
| `npm --prefix backend run verify:realtime` | PASS, 5 scoped deliveries, 0 errors |
| `npm run security:deps` | PASS for high/critical vulnerabilities |

## Scores

| Area | Score | Notes |
| --- | ---: | --- |
| Architecture | 88/100 | Projection, cache, queue, and realtime contracts are present. Live stress remains pending. |
| Security | 91/100 | Role isolation, route authorization, rules, storage, and timeline tenant scoping passed. |
| Realtime | 94/100 | SSE route, ticket, ack, single-connection, and scoped delivery checks passed. |
| Firestore | 86/100 | Required indexes pass. Local live read audits timed out and must be repeated in staging. |
| Performance | 82/100 | Build, cache, bundle, and API efficiency pass. High-risk endpoints remain watch-list items. |
| Scalability | 78/100 | Static checks are good; k6 stress run was not executed locally. |
| Production Readiness | 86/100 | YELLOW until staging stress and live Firestore latency gates pass. |

## Top 20 API / Query Risk Watch List

| Rank | Method | Route | Controller | Risk | Score |
| ---: | --- | --- | --- | --- | ---: |
| 1 | PATCH | `/api/documents/:id/status` | `updateDocumentStatus` | high | 25 |
| 2 | GET | `/api/leads` | `getLeads` | high | 25 |
| 3 | POST | `/api/dealer/register` | `registerDealerOnboarding` | high | 24 |
| 4 | GET | `/api/dashboard/fast` | `getFastDashboard` | high | 24 |
| 5 | POST | `/api/leads/public` | `createPublicLeadIntake` | high | 23 |
| 6 | POST | `/api/leads` | `createLead` | high | 22 |
| 7 | POST | `/api/documents/upload` | `uploadDocument` | high | 22 |
| 8 | GET | `/api/documents/:id/view` | `viewDocument` | medium | 19 |
| 9 | GET | `/api/documents/lead/:leadId` | `getLeadDocuments` | medium | 19 |
| 10 | POST | `/api/admin/bank-branches/:bankId/approve` | `approveBankBranchAdmin` | medium | 18 |
| 11 | GET | `/api/dashboard/overview` | `getOverview` | medium | 18 |
| 12 | POST | `/api/admin/bank-branches/:bankId/reject` | `rejectBankBranchAdmin` | medium | 18 |
| 13 | POST | `/api/leads/create` | `createPublicLead` | medium | 18 |
| 14 | POST | `/api/admin/bank-branches/:bankId/deactivate` | `deactivateBankBranchAdmin` | medium | 17 |
| 15 | POST | `/api/admin/approvals/banks/:id/suspend` | `suspendBankApproval` | medium | 17 |
| 16 | GET | `/api/admin/analytics/overview` | `getAnalyticsOverview` | medium | 17 |
| 17 | PATCH | `/api/leads/:id/status` | `updateLeadStatus` | medium | 16 |
| 18 | POST | `/api/dealer/register/status` | `getDealerRegistrationStatus` | medium | 16 |
| 19 | GET | `/api/gm/salespersons` | `getGmSalespersons` | medium | 16 |
| 20 | GET | `/api/gm/leads/:id` | `getGmLead` | medium | 16 |

## Firestore / Slow Query Findings

1. Missing indexes: none found by `audit:firestore-indexes`.
2. Unbounded list scans: blocked by production contract tests.
3. Workflow logs: optimized estimated reads are 1 for the local audit path, but the Firestore query timed out locally. Repeat in staging.
4. Timeline latest rows: estimated reads are 1 for the local audit path, but the Firestore query timed out locally. Repeat in staging.
5. Bank analytics aggregate: audit requires `BANK_ANALYTICS_SUMMARY_ID` to measure one deployed branch summary. Without it, estimated reads are 0 and no live branch was measured.
6. API efficiency inventory: 153 routes scanned; 120 low, 26 medium, 7 high, 0 critical.

## Duplicate Reads, APIs, and Code

No critical duplicate read/API/code blocker was detected by the current harness.

Watch-list items:
1. Document status and document upload endpoints touch multiple collections and should stay projection-first/background-safe.
2. Registration status and registration submit paths use several collections; keep them out of dashboard hot paths.
3. Dashboard overview and analytics endpoints should continue moving toward aggregate/projection reads only.
4. Vendor bundles `react` and `firebase-auth` are the only large frontend chunks reported.

## Security Findings

Resolved:
1. Timeline list tenant scoping is now explicit beyond role visibility.

Passed:
1. No super-admin wildcard bypass for protected portals.
2. Role mismatch does not auto-switch portals.
3. Backend auth verifies Firestore identity and rejects unverified email.
4. Login enforces exact portal role before mutating frontend session.
5. Bank manager lead access requires same bank and branch scope when branch data exists.
6. Firestore and Storage default wildcards deny access.
7. Audit logs and system counters are client-immutable.

Residual:
1. `npm audit` reports 8 moderate transitive issues under `firebase-admin` / Google SDK packages. The project gate passes because there are no high or critical vulnerabilities. Clearing all moderate advisories requires a breaking major upgrade according to npm.

## Realtime Findings

Passed:
1. SSE is the only dashboard realtime transport.
2. One user / one connection contracts are present.
3. SSE ticket, event stream, ack, and cleanup contracts are present.
4. Realtime delivery verification sent a lead status update to admin, finance, GM, bank manager, and loan executive with 0 delivery errors.
5. Lead assignment, reassignment, status update, dead case, notification, and dashboard mutation contracts are covered by tests/invariants.

## Performance Findings

Passed:
1. Frontend lint passed.
2. Frontend production build passed from root prefix and direct frontend execution.
3. Bundle report passed with large vendor warnings only.
4. Dashboard row retention, first-paint cache hydration, and sidebar prefetch invariants passed.
5. API efficiency strict mode passed.

Remaining live gates:
1. Run k6 smoke/auth/dashboard/leads/firestore/queue/upload scenarios in staging.
2. Capture assignment, notification, SSE, counter, and patch latency percentiles against deployed Firestore.
3. Confirm p95 target under 1 second for realtime dashboard propagation.

## Immediate Fixes Completed

1. Harden timeline list tenant scoping.
2. Fix root-prefix Vite production build.

## Medium Priority Fixes

1. Install k6 in CI and require staging stress output before production deployment.
2. Add live Firestore latency report artifacts for workflow, timeline, and bank analytics aggregate audits.
3. Review high-score API watch-list endpoints for additional cache/projection opportunities.
4. Plan the `firebase-admin` / Google SDK major upgrade in a controlled branch.

## Long-Term Improvements

1. Expand API efficiency audit from static scoring into measured p50/p95/p99 route latency.
2. Store recurring go-live audit outputs as CI artifacts.
3. Add automated bundle budget thresholds for vendor chunks.
4. Add recurring production read-budget reports from Firestore usage exports.

