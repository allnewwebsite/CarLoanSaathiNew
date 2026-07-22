# CarLoanSaathi Enterprise Lead Lifecycle Audit

Generated: 2026-07-17  
Mode: read-only application audit; no application code, API, UI, or Firestore data was changed.

## 1. Scope and evidence boundary

This report describes the behavior implemented in the current `C:\CarLoanSaathi` repository. The repository contains the Express backend and React web portal. It does **not** contain the separate Loan Executive mobile application source; therefore mobile behavior cannot be certified from this repository. Any mobile client using these APIs is constrained by the backend rules described here, but its local UI, cache, offline, and download behavior remains unverified.

Primary evidence:

- `backend/utils/status.constants.js` — canonical statuses, labels, legacy mappings, transition graph.
- `backend/controllers/lead.controller.js` — generic creation/list/status API.
- `backend/controllers/dealerLead.controller.js` — current Finance Desk creation and read workflow.
- `backend/controllers/bankLeadWorkflow.controller.js` — acceptance, rejection, status, remarks, reassignment.
- `backend/services/deadCase.service.js` — independent dead-case lifecycle.
- `backend/controllers/document.controller.js` and `bankDocument.controller.js` — customer/bank documents.
- `backend/services/assignment.service.js` — branch/executive assignment.
- `backend/services/projection*.js`, `leadQuery.service.js`, `realtime*.js`, `notification.service.js`, `timeline.service.js`.
- Web route files, pages, constants, Firestore rules, and `firestore.indexes.json`.

## 2. Status inventory

### 2.1 Canonical lead statuses

The backend accepts 16 canonical values:

| Canonical value | Display label | Current meaning |
|---|---|---|
| `NEW` | New | Newly created/intake lead. |
| `CONTACTED` | Contacted | Executive has contacted the customer. |
| `REQUEST_DOCUMENT` | Pending Documents | Legacy/current document-request state. |
| `DOCUMENT_RECEIVED` | Document Received | A document-received workflow state. |
| `REQUEST_PENDING_DOCUMENTS` | Pending Documents | Primary web UI state for additional documents requested. |
| `ALL_DOCUMENTS_RECEIVED` | Document Received | Legacy/detailed state indicating all requested documents received. |
| `UNDER_BANK_PROCESS` | Under Bank Process | Current processing state shown by web portals. |
| `ASSIGNED` | New | Assignment-era state, visually collapsed to New. |
| `ACCEPTED` | Accepted | Explicit acceptance through `/bank/leads/:id/accept`. |
| `UNDER_REVIEW` | Under Review | Detailed/legacy bank-review state. |
| `DOCS_PENDING` | Pending Documents | Detailed/legacy pending-document state. |
| `APPROVED` | Under Bank Process | Approval-era state, visually collapsed to Under Bank Process. |
| `REJECTED` | Rejected | Bank rejection; reason is required by the dedicated reject API and UI modal. |
| `DISBURSED` | Disbursed | Loan disbursement completed. |
| `CLOSED` | Closed | Canonical terminal status. It is not exposed in current web status selectors. |

`ALLOWED_LEAD_STATUSES` is `Object.values(LEAD_STATUSES)`. `leadSchema` accepts exactly these values.

### 2.2 Legacy values normalized into canonical statuses

`New`, `Contacted`, `Request Document`, `Document Received`, `Request Pending Documents`, `Pending Documents`, `All Documents Received`, `Under Bank Process`, `Assigned`, `Under Review`, `Bank Processing`, `Bank Process`, `Docs Pending`, `Pending Docs`, `Approved`, `Rejected`, `Disbursed`, and `Closed` are normalized by `LEGACY_STATUS_TO_STANDARD`.

Important inconsistency: the frontend legacy map contains `Accepted`, while the backend legacy map does not. A stored literal `Accepted` can therefore normalize differently between client and server.

### 2.3 Dead Case is an orthogonal state, not a status

Dead Case is represented by `isDeadCase: true` plus `deadCaseDate`, `deadCaseBy`, `deadCaseReason`, and notes. Moving a case to Dead does **not** replace its canonical `status`; restoring it sets `isDeadCase: false` and preserves the former status. Consequently, combinations such as `REJECTED + isDeadCase:true` and `DISBURSED + isDeadCase:true` are technically representable.

Allowed dead-case reasons are Customer Not Interested, Customer Unreachable, Duplicate Lead, Rejected By Customer, Rejected By Bank, Vehicle Purchase Cancelled, Documentation Issue, and Other.

### 2.4 Non-lead statuses

Document statuses (`Uploaded`, `Approved`, `Pending`, `Requested`, `Rejected`), assignment statuses (`assigned`, `accepted`, etc.), intake statuses, account statuses, and notification/queue statuses are separate domains and are not lead statuses.

## 3. Implemented lifecycle

```text
Public application or Finance Desk creation
                    |
                   NEW
                    |
       automatic branch/executive assignment
        (status may remain NEW; assignment fields change)
                    |
       Loan Executive web status action
                    |
    +---------------+--------------------+
    |               |                    |
 CONTACTED   REQUEST_PENDING_DOCUMENTS  UNDER_BANK_PROCESS
                    |                    |
          DOCUMENT_RECEIVED              |
                    |                    |
                    +--------------------+
                              |
                    REJECTED or DISBURSED

Independent Finance Desk action from a mutable lead:
Any canonical status -- set isDeadCase=true --> Dead Cases
Dead Cases -- restore --> same canonical status, isDeadCase=false
```

The code also declares richer paths involving `ASSIGNED`, `ACCEPTED`, `UNDER_REVIEW`, `DOCS_PENDING`, `APPROVED`, `ALL_DOCUMENTS_RECEIVED`, and `CLOSED`; most are not offered by the current web status modal.

## 4. Declared transition matrix

This is the exact server constant in `VALID_TRANSITIONS`:

| From | Allowed targets |
|---|---|
| `NEW` | `CONTACTED`, `REQUEST_DOCUMENT`, `REQUEST_PENDING_DOCUMENTS`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `ASSIGNED`, `UNDER_REVIEW`, `DOCS_PENDING`, `CLOSED` |
| `CONTACTED` | `REQUEST_DOCUMENT`, `DOCUMENT_RECEIVED`, `REQUEST_PENDING_DOCUMENTS`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `CLOSED` |
| `REQUEST_DOCUMENT` | `DOCUMENT_RECEIVED`, `REQUEST_PENDING_DOCUMENTS`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `CLOSED` |
| `DOCUMENT_RECEIVED` | `REQUEST_PENDING_DOCUMENTS`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `CLOSED` |
| `REQUEST_PENDING_DOCUMENTS` | `DOCUMENT_RECEIVED`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `CLOSED` |
| `ALL_DOCUMENTS_RECEIVED` | `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, `CLOSED` |
| `UNDER_BANK_PROCESS` | `DISBURSED`, `REJECTED`, `CLOSED` |
| `ASSIGNED` | `CONTACTED`, `REQUEST_DOCUMENT`, `UNDER_BANK_PROCESS`, `ACCEPTED`, `UNDER_REVIEW`, `DOCS_PENDING`, `REJECTED`, `CLOSED` |
| `ACCEPTED` | `CONTACTED`, `REQUEST_DOCUMENT`, `UNDER_BANK_PROCESS`, `DOCS_PENDING`, `APPROVED`, `REJECTED`, `CLOSED` |
| `UNDER_REVIEW` | `REQUEST_PENDING_DOCUMENTS`, `UNDER_BANK_PROCESS`, `DOCS_PENDING`, `APPROVED`, `REJECTED`, `DISBURSED`, `CLOSED` |
| `DOCS_PENDING` | `DOCUMENT_RECEIVED`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `APPROVED`, `REJECTED`, `CLOSED` |
| `APPROVED` | `UNDER_BANK_PROCESS`, `DISBURSED`, `CLOSED` |
| `REJECTED` | `NEW`, `ASSIGNED`, `CLOSED` |
| `DISBURSED` | `CLOSED` |
| `CLOSED` | none |

Same-status updates are accepted as no-op transitions by `assertValidStatusTransition`.

### Transition characteristics

- Declared terminal: `CLOSED` only.
- Backward/reopen paths: `REJECTED -> NEW` and `REJECTED -> ASSIGNED`.
- Circular paths exist: `REQUEST_DOCUMENT <-> REQUEST_PENDING_DOCUMENTS` indirectly through received/pending states; `APPROVED -> UNDER_BANK_PROCESS` while other paths lead back toward approval-era states.
- `DISBURSED` may only become `CLOSED` in the declared graph.
- Dead-case restore is not a status transition; it returns to the unchanged stored status.
- The current UI exposes only `CONTACTED`, `DOCUMENT_RECEIVED`, `UNDER_BANK_PROCESS`, `DISBURSED`, `REJECTED`, and `REQUEST_PENDING_DOCUMENTS`.

### Critical enforcement gap

`PATCH /api/leads/:id/status` calls `assertValidStatusTransition`, but the primary web endpoint `PATCH /api/bank/leads/:id/status` only checks that the target belongs to the broad `bankStatuses` list. It does **not** call `assertValidStatusTransition`. As implemented, a Loan Executive using the bank endpoint can submit otherwise illegal transitions, including moving `DISBURSED` back to `NEW` or pending, provided the lead remains accessible and is not a dead case. The ordinary UI limits choices, but direct API calls can bypass the declared graph.

## 5. Per-status behavior and side effects

All status mutations write the canonical `leads` document and synchronize lead projections. Exact auxiliary fields differ by target:

| Status/group | Entry trigger and actor | Validation/payload | Side effects |
|---|---|---|---|
| `NEW` | Finance Desk creation, public intake, or declared reopen from Rejected. | Finance creation requires subscription, dealership scope, bank/IFSC and salesperson validation in the current dealer flow. Public intake is rate-limited and risk-tagged. | Lead projection, creation timeline/audit/analytics/notifications/WhatsApp depending on entry endpoint, realtime `LEAD_CREATED`; assignment may follow. |
| `ASSIGNED` | Declared transition or assignment-era data. Automatic assignment primarily changes assignment fields and can leave status `NEW`. | Branch/executive ownership checks occur in assignment service. | `leadAssignments`, assignment fields, projections, assignment notifications/WhatsApp, `LEAD_ASSIGNED`/`LEAD_REASSIGNED` events. |
| `ACCEPTED` | Loan Executive `PATCH /bank/leads/:id/accept`. | Must be assigned/access-allowed; declared transition asserted. | Lead and matching `leadAssignments` record updated, timeline `executive-accepted`, audit, projection, cache clears, realtime status update, WhatsApp. No explicit in-app notification in this handler. |
| `CONTACTED` | Loan Executive status modal/API. | Target allowed by web selector; bank endpoint does not validate source transition. | Status metadata, projection, list/detail/summary cache clear, realtime status update; asynchronous timeline, three portal notifications, audit and WhatsApp. |
| `REQUEST_DOCUMENT`, `REQUEST_PENDING_DOCUMENTS`, `DOCS_PENDING` | Loan Executive requests missing documents through status update, or document review marks a document Pending/Requested/Rejected. | Request can contain deduplicated document names and notes. Dead leads rejected. Document-review API requires Loan Executive and assigned lead access. | Pending arrays/history/reason on lead; Finance/GM/Bank Manager notifications for bank workflow; document review sends pending notification; timeline, audit, WhatsApp, projection, realtime `LEAD_STATUS_UPDATED` or `DOCUMENT_REQUESTED`. |
| `DOCUMENT_RECEIVED`, `ALL_DOCUMENTS_RECEIVED` | Loan Executive status update. Uploading a document alone does not automatically select these statuses. | Target allow-list; no required proof that all documents exist. | Clears pending fields for `DOCUMENT_RECEIVED`/`ALL_DOCUMENTS_RECEIVED`; standard status side effects. |
| `UNDER_REVIEW` | Declared detailed workflow/API submission. Not exposed in current status UI. | Broad bank allow-list only on primary endpoint. | Standard status side effects. |
| `UNDER_BANK_PROCESS` | Loan Executive status update. | Clears pending document arrays; no mandatory sanction/approval fields. | Standard status side effects and commissions evaluation. |
| `APPROVED` | Detailed/legacy API status. Current UI labels it Under Bank Process and does not offer it. | Optional approval amount, ROI, tenure, EMI, fee, sanction fields; no schema requires them. | Approval timeline event, standard notifications/audit/WhatsApp, commission evaluation. |
| `REJECTED` | Dedicated reject API or status modal. | Dedicated endpoint requires a reason and asserts transition; primary status endpoint accepts an empty rejection reason and does not assert source transition. | Rejection fields; dedicated endpoint creates two timeline records and one Finance notification; generic bank endpoint creates standard three-role notifications/timeline/audit asynchronously. Reassignment is manual, not automatic. |
| `DISBURSED` | Loan Executive status update. | Optional disbursal amount/date/UTR/remarks; no mandatory field validation in controller. | Clears pending fields; disbursement timeline/audit, notifications, WhatsApp, commission evaluation, projections/counters/realtime. |
| `CLOSED` | Declared transitions only; not included in `bankStatuses` and not exposed by current web UI. | Generic `/api/leads/:id/status` could accept it for an assigned Loan Executive; current bank endpoint rejects it. | Generic status timeline/notification/audit/projection/realtime. Operationally difficult to reach from current UI. |
| Dead Case | Finance Desk dead-case API, independent of canonical status. | Finance Desk only, same dealership, valid reason, notes length; duplicate mark returns conflict. | Updates lead flags, projection, timeline, audit, notification, realtime dead-case event and cache invalidation. Restore preserves status. |

## 6. Portal capability matrix

These are API-backed capabilities, not merely visible buttons.

| Capability | Finance Desk | GM | Bank Manager | Loan Executive web | Super Admin |
|---|---|---|---|---|---|
| See/search active scoped leads | Yes, dealership scoped | Yes, dealership scoped | Yes, bank/branch scoped | Yes, assigned identity scoped | Yes, platform-wide |
| See dead cases | Yes, dealership | Yes, dealership read-only | Yes, bank/branch | Yes where executive identity matches | No dedicated admin dead-case route, but admin lead list/detail can include/read records depending projection/query behavior |
| Create lead | Yes | No | No | No | No authenticated admin creation route |
| Change lead status | No route | No route | No status route permission | Yes | No admin mutation route |
| Accept/reject | No | No | No | Yes | No |
| Upload customer documents | Yes for owned dealership lead | No | No | No | Route role guard limits upload to Finance Desk despite controller containing a super-admin branch |
| Read/download customer documents | Yes, owned | Yes, same dealership | Yes, same bank/branch | Yes, assigned | Yes |
| Review customer document status | No | No | No | Yes | Route requires Loan Executive, so controller's super-admin allowance is unreachable |
| Upload/delete bank documents | No via bank route | No | Yes if bank access succeeds | Yes if assigned | No |
| Add bank remarks | No | No | Yes if bank access succeeds | Yes if assigned | No |
| Reassign | No | No | Yes only | No | No lead reassignment endpoint |
| Mark dead/restore/edit dead metadata | Yes | No | No | No | No |
| Delete lead | No endpoint | No endpoint | No endpoint | No endpoint | No direct lead-delete endpoint |
| Reopen Rejected | No UI/API | No | No | Technically possible via unvalidated bank status endpoint; not offered by current UI | No |
| Continue changing a dead lead | Dead-case metadata/restore only; customer-document upload is blocked by `assertLeadMutable` | Read only | Read only | Mutations blocked with `409 DEAD_CASE_IMMUTABLE` | Read only through available routes |

Status generally does not remove visibility. Ownership/scope fields, assignment identity, bank/branch association, and `isDeadCase` determine list placement and access. Rejected and Disbursed are excluded from `EXECUTIVE_ACTIVE_LEAD_STATUSES`, but remain queryable through status/dead-case/detail paths where access checks pass.

### Mobile

No mobile source is present. Backend expectations for a Loan Executive mobile client are: authenticated Loan Executive role, correct portal/session headers, assigned-lead identity, the same bank status/document endpoints, and the same dead-case immutability. UI visibility, local search, offline storage, caching, and download behavior cannot be asserted.

## 7. Database and ownership behavior

### Canonical and supporting collections

- `leads`: canonical lifecycle, assignment, pending-document, approval/rejection/disbursal, and dead-case fields.
- `leadAssignments`: assignment records; accept updates matching assignment status.
- `documents`: Finance/customer documents and review status.
- `bankDocuments`: Loan Executive/Bank Manager uploads such as sanction/query documents.
- `timeline`: append-only business events; projected to `timelineProjection`.
- `notifications`: scoped recipient records; projected into notification views.
- audit-log collection through `writeAuditLog`.
- analytics/commission/WhatsApp queue collections through asynchronous side effects.

### Lead projections

Each lead sync can write `adminViews`, `financeViews`, `gmViews`, `bankViews`, `executiveViews`, `leadDetailsProjection`, and `bankDealershipViews`, plus a `bankDealershipLeadProjection` marker. Projection documents contain source version/timestamp metadata and are freshness-checked with canonical fallback/backfill behavior.

### Ownership

- Dealership ownership: dealership ID/email, dealer email, and creator fields.
- GM: same dealership scope.
- Bank Manager: bank plus branch/IFSC scope.
- Loan Executive: strong assigned identity fields (ID, UID, email, mobile/job identifiers) plus bank/branch controls.
- Admin: global read access through admin routes.
- Reassignment changes executive ownership, updates assignment records/projections and emits assignment events; old executive access should cease after projections/caches converge and server identity checks use the updated canonical lead.

### Indexes

Composite indexes exist for dealership/bank/executive plus status and creation time, dead cases by scope/date, lead assignments, notifications, timeline projections, and projection view/scope/status combinations. The large index set supports scoped pagination but increases write amplification for every lead mutation.

## 8. Documents, notes, and timeline after status changes

- Finance Desk can upload any customer document while the lead is mutable; upload permission does not depend on requested documents.
- Pending requests are informational plus workflow metadata, not upload authorization.
- Loan Executive can view/download all assigned customer documents and review their document status.
- Bank Manager can read customer documents for its bank/branch and can upload/delete bank documents through bank routes.
- Dead cases block customer upload, review, bank uploads/deletes, remarks, status updates, accept/reject, and reassignment through `assertLeadMutable`/`requireAssignedLead`.
- There is no general free-form timeline-write endpoint. Timeline continues only when an allowed mutation creates an event.
- Bank remarks can be added regardless of canonical status while the lead is mutable; there is no terminal-status guard separate from dead-case immutability.

## 9. Realtime, notifications, caches, and counters

### Realtime

Lead creation, assignment/reassignment, status, document, remarks, and dead-case changes publish authenticated SSE events. Event registry scopes recipients by dealership, bank, branch, and assigned executive. Lead status uses `LEAD_STATUS_UPDATED`; documents use `DOCUMENT_UPLOADED`/`DOCUMENT_REQUESTED`; dead cases use dedicated events.

Frontend listeners patch/invalidate tables, details, counters, and notification badges and use background refresh hooks. This is eventual synchronization; projections and SSE are not part of a single Firestore transaction with the canonical mutation.

### Notifications

The main bank status workflow asynchronously creates three notifications: Bank Manager, Finance Desk, and GM. Pending-document requests include requested-document metadata. Dedicated rejection and document-review handlers have different notification shapes, creating duplicated behavior across APIs.

### Cache invalidation

Mutations clear combinations of `lead:list`, `lead:<id>`, `admin:summary`, `bank:summary`, `bank:notifications`, `bank:executives`, dealership/bank lead tags, and detail caches. Firestore service writes also clear record/query caches and projection writes update views. Invalidation is tag-based and not transactionally coupled to all asynchronous side effects.

### Counters/analytics

Dashboard counts are generally derived from filtered lead/projection queries and summary projections. Status changes refresh lead projections and clear summary caches. `DISBURSED`, `REJECTED`, and `CLOSED` are treated as non-pending in GM salesperson summaries. Finance earnings filter `DISBURSED`. Bank analytics uses aggregate/projection services. Commission evaluation runs asynchronously for generic/bank status changes.

## 10. Search, filters, exports, and UI reachability

- Active list queries filter out `isDeadCase:true`; dead-case queries explicitly require it.
- Search fields include case/customer/mobile/vehicle/city/bank/branch/IFSC/executive fields.
- Web status tabs expose six normalized workflow states. Several distinct backend states collapse into the same label:
  - `ASSIGNED -> New`
  - `REQUEST_DOCUMENT`, `REQUEST_PENDING_DOCUMENTS`, `DOCS_PENDING -> Pending Documents`
  - `DOCUMENT_RECEIVED`, `ALL_DOCUMENTS_RECEIVED -> Document Received`
  - `APPROVED -> Under Bank Process`
- This label collapsing makes analytics and user interpretation lossy.
- Dead Cases has separate search and pagination behavior.
- Admin list/detail and analytics are read-only for leads.
- `CLOSED`, `ACCEPTED`, `UNDER_REVIEW`, `APPROVED`, `ASSIGNED`, `REQUEST_DOCUMENT`, `ALL_DOCUMENTS_RECEIVED`, and `DOCS_PENDING` are not directly selectable in the current web status modal.

## 11. Security findings

### Controls present

- All non-public lead APIs require JWT authentication and portal/role/session checks.
- Creation is Finance Desk-only and subscription-gated.
- Status mutations are Loan Executive-only; reassignment is Bank Manager-only.
- Canonical lead access is checked against dealership/bank/branch/executive ownership.
- Document URLs are short-lived; document viewing is audited.
- Dead cases are immutable outside the Finance Desk dead-case workflow.
- Firestore client rules deny broad direct client mutation; backend Admin SDK is the primary writer.

### Findings

1. **High — transition validation bypass:** `/api/bank/leads/:id/status` does not call `assertValidStatusTransition`; direct callers can perform illegal backward/terminal transitions.
2. **Medium — rejection validation differs by endpoint:** dedicated reject requires a reason; generic bank status accepts `REJECTED` without requiring one.
3. **Medium — disbursement/approval evidence is optional:** amounts, dates, UTR, sanction and approval fields are copied when supplied but are not required before status mutation.
4. **Medium — status does not enforce immutability:** `DISBURSED` and `CLOSED` are not independently immutable. Remarks and bank-document mutations remain possible unless the lead is also dead; the unvalidated status endpoint can move Disbursed backward.
5. **Low/medium — unreachable controller permissions:** document controller allows Super Admin upload/review internally, but route-level `requireRole` blocks Super Admin. This is contradictory dead code rather than an escalation.
6. **Low — legacy normalization mismatch:** frontend recognizes literal `Accepted`, backend does not.
7. **Eventual old-owner exposure risk:** reassignment clears caches and synchronizes projections, but asynchronous clients may briefly retain previously fetched lead data. Canonical API authorization prevents continued server access after ownership changes; local already-rendered data cannot be remotely erased instantly.

## 12. Performance observations

1. A single status change can cause the canonical write, multiple projection writes, three notifications and their projections, timeline write/projection, audit write, commission evaluation, WhatsApp queueing, realtime publication, and index maintenance. This is substantial write amplification.
2. `queueBankLeadStatusSideEffects` uses `setImmediate` plus `Promise.allSettled`, so the API returns quickly, but notification/timeline/audit failures do not fail or retry the status response here.
3. Projection reads fall back to canonical queries and schedule backfill on misses/staleness. This protects correctness but can create burst reads on cold/new deployments.
4. Search uses bounded/paginated query helpers and projection views; broad multi-field search may still require over-fetching/filtering depending on query shape.
5. Dedicated reject and generic status workflows duplicate timeline/notification/audit logic and can produce different numbers/shapes of downstream writes for the same business outcome.
6. Firestore indexes are extensive; they reduce query latency but add write cost and deployment/index-management complexity.
7. Dead-case query paths have dedicated composite indexes and exclude dead records from active results, avoiding full active/dead merging in normal lists.

## 13. Hidden bugs, contradictions, and missing business rules

### Confirmed inconsistencies

- Declared transition graph is bypassed by the main web bank endpoint.
- Dedicated and generic status APIs implement different rejection validation and side effects.
- Six visible workflow states coexist with 16 canonical values and lossy labels.
- `APPROVED` is labeled `Under Bank Process`; the UI cannot distinguish approval from processing.
- `ASSIGNED` is labeled `New`; assignment and lifecycle are conflated visually.
- Automatic assignment may update assignment fields without advancing canonical status to `ASSIGNED`.
- `CLOSED` is terminal in constants but absent from current bank allow-list/UI, making normal closure effectively unreachable.
- Dead-case state preserves canonical status, so status-based analytics must also consider `isDeadCase` or risk counting dead records.
- Customer document upload does not automatically advance document-received lead status; status can claim documents received without checking documents.
- Pending-document clearing is driven by status selection, not verified completeness.
- Bank Manager and Loan Executive share remarks and bank-document routes; role distinctions rely on `requireAssignedLead`/partner access rather than explicit route guards.

### Missing explicit business rules

- Mandatory fields/evidence for Approved and Disbursed.
- Whether Rejected should be reopenable, by whom, and with approval/audit requirements.
- Whether Disbursed can accept remarks/documents or ever be reassigned.
- Whether Closed should be reachable and who closes cases.
- Whether any terminal status may be moved to Dead Cases.
- Required correspondence between lead status and actual document checklist.
- SLA/escalation rules for prolonged statuses.
- Idempotency keys/version checks for concurrent status updates.
- A single authoritative endpoint/service for every status transition.

## 14. Enterprise recommendations — not implemented

1. Route all status mutations through one domain service that enforces `VALID_TRANSITIONS`, role, ownership, required fields, optimistic version, audit, and idempotency.
2. Immediately enforce `assertValidStatusTransition` in the primary bank status handler and require rejection/disbursement/approval evidence by target status.
3. Decide on one canonical business workflow. Remove unused statuses or expose them intentionally; do not hide distinct states behind identical labels without a documented reporting model.
4. Define terminal-state policy for Rejected, Disbursed, Closed, and Dead Case, including document/remarks/reassignment permissions.
5. Treat Dead Case explicitly in all analytics and projections; define whether it is a lifecycle status or orthogonal archive flag.
6. Consolidate dedicated accept/reject and generic status side effects to prevent divergent notifications, audits and timelines.
7. Use an outbox/idempotent worker for notification, timeline, analytics, WhatsApp and projection side effects so successful canonical changes have observable, retryable downstream delivery.
8. Add transition-matrix integration tests for every source/target pair and every role, including direct API attempts, dead cases, stale assignment, concurrent updates, and projection freshness.
9. Audit the separate mobile repository against the same API matrix before certifying cross-platform behavior.
10. Add operational dashboards for status age, projection lag, side-effect failures, duplicate notifications, illegal-transition attempts, and Firestore reads/writes per transition.

## 15. Certification conclusion

The platform has a substantial implemented lifecycle with scoped authorization, projections, audit/timeline records, notifications, SSE, dead-case isolation, and indexed queries. However, it does not currently have one consistently enforced enterprise state machine. The primary Loan Executive web endpoint can bypass the declared transition graph, and several important terminal/evidence rules are absent or contradictory.

**Audit classification: YELLOW for understanding/continued controlled testing; RED for claiming a strictly enforced enterprise lead lifecycle until the transition-validation bypass and terminal/evidence policies are resolved.**

No recommendation in this report has been implemented.
