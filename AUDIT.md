# CarLoanSaathi Current Platform Workflow Audit

Generated: 2026-07-17  
Audit type: current-state, read-only code audit  
Application code changed: **No**

## 1. Purpose

This document explains how the CarLoanSaathi platform currently works from account onboarding and lead creation through assignment, document collection, bank processing, rejection, disbursement, dead-case handling, analytics, notifications, and post-completion behavior.

It describes only implemented behavior. Where the platform does nothing automatically, that is stated explicitly.

The audited repository contains:

- Express.js backend
- React web portals
- Firestore persistence, projections and indexes
- Firebase authentication and storage integration
- SSE realtime infrastructure
- Notification, timeline, audit, WhatsApp, analytics, commission and scheduler services

The separate Loan Executive native mobile application source is not present in this workspace. Its UI/offline behavior cannot be certified here, although its backend requests remain subject to the same API rules.

## 2. Platform actors and portals

| Actor | Main responsibility | Current lead authority |
|---|---|---|
| Public customer | Submits public loan enquiry | Can create public intake only; no authenticated case management |
| Finance Desk / Finance Manager | Creates dealership leads, uploads customer documents, manages dealership staff and dead cases | Create/read dealership leads; upload customer documents; manually move/restore dead cases |
| General Manager | Tracks dealership cases, staff and status | Read/search dealership leads and documents; no lead mutation route |
| Bank Manager | Manages branch executives and assigned bank cases | Read bank/branch leads; reassign; add remarks; upload/delete bank documents; no status-change route |
| Loan Executive | Processes assigned cases | Accept, reject, change status, request documents, review customer documents, add remarks, upload/delete bank documents |
| Super Admin | Platform supervision, approvals, monitoring and analytics | Global lead read access; no direct lead status/reassignment/delete route |

## 3. Account and access prerequisites

Before dashboard access, each authenticated request is checked for a valid JWT, active account, correct role, portal, login portal, organization scope, session record, email verification and password lifecycle requirements.

- Finance and GM accounts also depend on dealership approval and subscription/dashboard entitlement.
- Bank Manager and Loan Executive accounts depend on bank approval and active account state.
- Portal-scoped browser sessions prevent one portal token from being reused as another portal.
- Route-level role middleware supplies coarse authorization; controllers then check lead ownership/scope.

If an account becomes inactive, deleted, role-changed, portal-changed, organization-changed or session-revoked, authenticated API access is rejected and the local scoped session is cleared.

## 4. Lead creation

### 4.1 Public application

The public `/api/leads/public` flow:

1. Validates applicant, mobile, city, vehicle, price, loan amount and employment information.
2. Rate-limits and applies public registration security.
3. Creates a lead with `status: NEW`, `publicIntake: true`, source metadata and an intake risk status.
4. High-risk/test-like submissions may receive `intakeStatus: review-required`; this is not a lead status.
5. Public intake does not give the customer dashboard access.

### 4.2 Finance Desk creation

The current Finance Desk `/api/dealer/leads` flow:

1. Requires an authenticated, approved Finance Desk session and active subscription entitlement.
2. Validates dealership ownership, vehicle/customer data, required bank branch/IFSC and salesperson/finance-manager identities.
3. Creates the canonical `leads` document with `status: NEW` and `isDeadCase: false`.
4. Attempts same-branch automatic Loan Executive assignment.
5. Synchronizes lead projections.
6. Creates timeline/audit/analytics/notification/WhatsApp effects.
7. Publishes a realtime lead-created event.
8. The web UI redirects Finance Desk to the customer-document page so documents can be uploaded immediately.

Automatic assignment failure does not delete the lead. It is recorded and can later be repaired by assignment-integrity processing.

## 5. Assignment and ownership

### Automatic assignment

Creation selects an eligible active executive for the selected bank/branch through round-robin/capacity logic. Assignment data is stored in:

- ownership fields on `leads`
- `leadAssignments`
- assignment history records
- lead projections for Finance, GM, Bank Manager, Loan Executive and Admin

Notifications, timeline/audit records, WhatsApp messages and realtime assignment events are created.

### Manual reassignment

Only a Bank Manager can call the reassignment workflow. The requested executive must be active and belong to the same bank/branch. Reassignment:

- marks the prior active assignment as no longer active
- updates lead owner/executive identity fields
- creates/updates `leadAssignments`
- records assignment history, timeline and audit information
- clears lead/list/bank/notification caches
- synchronizes projections and analytics
- emits realtime reassignment
- notifies the new executive and relevant users

The old executive should fail future canonical API access after ownership changes. Already rendered browser data can remain visible until the client processes realtime/refetches.

### Important current behavior

Reassignment writes the lead status back to `NEW`. There is no separate guard preventing a mutable Rejected or Disbursed lead from being reassigned. Therefore, a Bank Manager can potentially reassign such a case and reopen it as New. Dead cases are protected and cannot be reassigned.

## 6. Current status model

The backend defines 16 canonical statuses:

`NEW`, `CONTACTED`, `REQUEST_DOCUMENT`, `DOCUMENT_RECEIVED`, `REQUEST_PENDING_DOCUMENTS`, `ALL_DOCUMENTS_RECEIVED`, `UNDER_BANK_PROCESS`, `ASSIGNED`, `ACCEPTED`, `UNDER_REVIEW`, `DOCS_PENDING`, `APPROVED`, `REJECTED`, `DISBURSED`, `CLOSED`.

The current web workflow exposes only:

- Contacted
- Document Received
- Under Bank Process
- Disbursed
- Rejected
- Pending Documents

Several canonical statuses collapse to the same display label:

| Internal statuses | Web label |
|---|---|
| `NEW`, `ASSIGNED` | New |
| `REQUEST_DOCUMENT`, `REQUEST_PENDING_DOCUMENTS`, `DOCS_PENDING` | Pending Documents |
| `DOCUMENT_RECEIVED`, `ALL_DOCUMENTS_RECEIVED` | Document Received |
| `UNDER_BANK_PROCESS`, `ACCEPTED`, `UNDER_REVIEW`, `APPROVED` | Under Bank Process |
| `DISBURSED`, and in some query helpers `CLOSED` | Disbursed |

This means users and some reports cannot visually distinguish all backend states.

## 7. Normal working lifecycle

```text
Customer/Public Enquiry or Finance Desk Creation
                         |
                        NEW
                         |
             Branch/Executive Assignment
                         |
              Loan Executive Reviews Lead
                         |
          +--------------+----------------+
          |              |                |
      CONTACTED   PENDING DOCUMENTS   UNDER BANK PROCESS
                         |                |
              Finance uploads files      |
                         |                |
                DOCUMENT RECEIVED         |
                         +----------------+
                                  |
                        REJECTED or DISBURSED

Separate manual archive path:
Any mutable case -> Finance Desk marks Dead -> restore to same prior status
```

The declared backend transition matrix is richer, but the primary Bank status endpoint does not currently enforce the source-to-target matrix. It checks only whether the requested target is in the broad bank status list.

## 8. What happens at each major stage

### New

- Appears in scoped lead lists/projections.
- Can be automatically assigned.
- Loan Executive can open the case if assignment identity matches.
- Finance can upload customer documents immediately.
- No automatic timer forces the executive to respond.
- The case remains New indefinitely until a user changes it, reassigns it or marks it dead.

### Contacted

- Selected manually by the Loan Executive.
- Lead status fields and timestamps update.
- Projection and cache refresh occurs.
- Finance Desk, GM and Bank Manager receive status notifications through the main workflow.
- Timeline, audit, WhatsApp, analytics/commission evaluation and SSE effects are queued.
- There is no required customer-contact note and no follow-up deadline.

### Pending Documents

The Loan Executive selects one or more missing documents and may add a remark. Supported standard types include Aadhaar, PAN, Salary Slip, ITR, Bank Statement, Electricity Bill, Rent Agreement, Form 16 and a named Other document.

The lead stores:

- active pending-document names
- request history
- request timestamp
- requesting executive identity/name
- request notes/reason

Finance Desk is notified and can upload any customer document—requested or not. Request status is informational and never disables Finance upload controls.

Uploaded customer documents are stored in `documents`. Upload generates timeline, notification, WhatsApp and realtime document events. A file upload alone does not automatically move the lead to Document Received or clear pending requests; the Loan Executive must update status.

If nobody supplies or processes the requested documents, the case remains Pending Documents indefinitely. There is no reminder schedule, expiry, escalation or auto-dead behavior.

### Document Received

- Selected manually by the Loan Executive.
- Pending document fields are cleared by the status handler.
- There is no backend validation proving every requested file is actually uploaded.
- It can therefore be selected even when requested files are missing.
- The standard notification/timeline/audit/SSE/projection workflow runs.

### Under Bank Process

- Selected manually by the Loan Executive.
- Pending fields are cleared.
- The case remains visible to its dealership, bank/branch and assigned executive.
- Documents and remarks can continue to be handled while the case is mutable.
- No mandatory sanction, approval, review checklist or SLA is validated.
- If the executive provides no further update, the case remains Under Bank Process indefinitely.

### Approved

`APPROVED` exists internally and can store approved amount, ROI, tenure, EMI, processing fee, sanction number/date and remarks. The current status modal does not expose Approved separately; it is displayed as Under Bank Process.

Approval fields are optional in the controller. Commission creation/evaluation can occur at Approved with a pending state.

### Rejected

The current web modal requires a rejection remark before submission. The primary handler stores rejection reason, rejection time, rejecting executive and remarks, then updates projections/caches and publishes SSE. Finance Desk, GM and Bank Manager receive status notifications; timeline/audit and WhatsApp effects are queued.

After rejection:

- The case remains in Firestore; it is not deleted.
- It remains searchable/viewable under scoped Rejected filters.
- Finance/GM/Admin can still read it.
- The assigned bank/executive can still read it when ownership checks pass.
- It is removed from active-executive counts.
- It contributes to rejected analytics.
- No automatic reassignment occurs.
- Finance Desk may manually mark it as a Dead Case.
- Bank remarks and bank documents remain technically mutable while it is not dead.
- The declared matrix permits Rejected -> New, Assigned or Closed.
- The primary status API can bypass the declared matrix, and Bank Manager reassignment resets status to New.

There are two rejection implementations: the dedicated reject endpoint and the generic bank status endpoint. They enforce different validation and create different downstream event shapes.

### Disbursed

When Loan Executive selects Disbursed:

- The lead stores optional disbursal amount, date, UTR number and remarks when provided.
- Pending-document fields are cleared.
- Projection and cache refresh occurs.
- Disbursement timeline/audit, notifications, WhatsApp and realtime status effects are queued.
- Bank analytics increments disbursed count/amount.
- Finance earnings and platform analytics count the case as disbursed.
- Commission/payout state is created or changed to `released`.
- The case is removed from active-executive counts.
- It remains permanently stored and remains visible/searchable through Disbursed views.
- Bank Manager dealership-disbursed views can show it.
- Documents and details remain readable by authorized portals.

The UI optionally allows a sanction letter upload after the status request. These are two separate API calls. The lead can become Disbursed even when no sanction letter is selected, and if the later upload fails, Disbursed status remains.

There is no automatic archival, closure, lock, settlement verification or post-disbursement follow-up job. The declared matrix says Disbursed may only become Closed, but the primary bank status endpoint does not enforce that matrix and reassignment can reset status to New. Remarks and bank documents also remain mutable unless the lead is dead.

### Closed

Closed is defined as terminal with no declared next status. It is not exposed in the current web status modal and is excluded from the primary bank status allow-list. Normal users therefore have no straightforward current UI path to close a case. Some query/report helpers group Closed with Disbursed.

### Dead Case

Dead Case is not a canonical lead status. It is an independent flag: `isDeadCase: true`.

Only Finance Desk can:

- mark a dealership-owned case dead
- choose an allowed dead-case reason
- edit dead-case reason/notes
- restore the case

Moving to Dead preserves the original canonical status. Active lists exclude it, while Dead Cases lists query it separately. The action creates projection, timeline, audit, notification, cache and realtime updates.

While dead:

- status changes are blocked
- assignment/reassignment is blocked
- customer document upload/review is blocked
- bank document upload/delete is blocked
- bank remarks are blocked
- Finance Desk can edit dead metadata or restore
- other authorized portals can view it through their Dead Cases scope

Restoring sets `isDeadCase:false` and returns it to the active workflow with the same canonical status it had before being marked dead.

## 9. What happens if the Loan Executive gives no reply or status update

This is an important current limitation.

There is **no implemented lead-response SLA engine**. The scheduler does not inspect lead age or `statusUpdatedAt` to detect inactivity.
There is also no status-update deadline: a missing reply and no status update produce no automatic workflow action.

Therefore, if a Loan Executive does nothing:

- New remains New.
- Contacted remains Contacted.
- Pending Documents remains Pending Documents.
- Under Bank Process remains Under Bank Process.
- No reminder is sent automatically.
- No escalation goes to Bank Manager, Finance Desk, GM or Admin.
- No automatic reassignment occurs because of inactivity.
- No automatic rejection, dead-case move or closure occurs.
- No SLA breach timeline/audit record is created.
- Dashboards only continue showing the existing status.

The scheduled `assignment-integrity` job checks recent records for missing or inconsistent assignment fields/projections/assignment notifications and may repair them. It does **not** measure executive response time or business inactivity.

The only remedies currently available are manual:

- Bank Manager views the case and reassigns it.
- Finance/GM follows up outside the system.
- Loan Executive eventually updates it.
- Finance Desk moves it to Dead Cases when appropriate.

## 10. Documents

### Customer documents

- Finance Desk uploads to `documents` for its dealership leads.
- Upload permission is independent of pending requests.
- Loan Executive sees every uploaded document, requested or not.
- GM, Bank Manager and Admin may read/download within their scopes.
- Document view returns a short-lived signed URL and records an audit event.
- Loan Executive can mark a document Uploaded/Approved/Pending/Requested/Rejected.
- Pending/Requested/Rejected document review can move the lead to Pending Documents and notify Finance.

### Bank documents

- Bank Manager or assigned Loan Executive can upload to `bankDocuments` when bank ownership checks pass.
- They can also delete bank documents while the case is mutable.
- Sanction-letter metadata may be copied to the lead.
- Finance/GM/Admin detail views can read bank documents within their scope.

No virus-scanning lifecycle, document-expiry workflow or mandatory completeness gate was identified in the status engine.

## 11. Notifications, WhatsApp, timeline and audit

Main bank status updates generally create:

- Bank Manager notification
- Finance Desk notification
- GM notification
- timeline event
- audit entry
- WhatsApp queue item
- realtime `LEAD_STATUS_UPDATED`

These side effects run asynchronously after the canonical status response in the primary bank handler. Failures are logged with `Promise.allSettled`; the status update is not rolled back and there is no controller-level retry guarantee.

Creation, assignment, documents, remarks, rejection and dead-case workflows also have specialized notification/timeline logic. Because these rules exist in several controllers/services, the same outcome can generate different recipient sets or event shapes depending on which endpoint was used.

Notification records are projected and delivered over authenticated SSE. Duplicate suppression uses metadata/dedupe keys in many workflows, but not every event is produced through one central path.

## 12. Realtime and browser synchronization

Authenticated SSE events are scoped by role plus dealership, bank, branch and assigned executive identity. Events patch or refresh:

- lead list rows
- lead detail
- counters
- notification badges
- document views
- dead-case views

Canonical API authorization remains authoritative. Realtime and projections are eventually consistent; a client can briefly display stale data until it processes the event or refetches.

## 13. Firestore and projections

Canonical collections involved in workflow include:

- `leads`
- `leadAssignments`
- assignment history/error collections
- `documents`
- `bankDocuments`
- `timeline`
- `notifications`
- audit logs
- `commissions`
- `payouts`
- WhatsApp queue/event collections
- analytics aggregate/state collections

Lead changes synchronize role-specific projections:

- `adminViews`
- `financeViews`
- `gmViews`
- `bankViews`
- `executiveViews`
- `leadDetailsProjection`
- `bankDealershipViews`
- `bankDealershipLeadProjection`

Timeline and notification projections are maintained separately. Projection freshness jobs detect and rebuild stale views, and read paths may fall back to canonical collections when projections are unavailable.

## 14. Dashboard and analytics behavior

- Active lists exclude `isDeadCase:true`.
- Dead Cases use dedicated indexed queries.
- Status filters normalize multiple internal statuses into six visible workflow groups.
- Rejected and Disbursed are excluded from active executive counts.
- GM pending counts exclude Rejected, Disbursed and Closed.
- Bank analytics tracks assigned, active, approved, rejected, pending-document and disbursed values.
- Finance earnings are based on Disbursed leads.
- Dead cases are excluded from bank analytic contribution.
- Projection and summary caches are invalidated after mutations, but updates are eventually consistent.

## 15. Scheduled and background operations

The scheduler currently handles:

- payment reconciliation when billing is enabled
- expired-notification cleanup
- metrics integrity
- projection freshness
- assignment integrity
- subscription lifecycle

It does **not** currently handle:

- lead inactivity
- no-response escalation
- pending-document reminders
- approval/disbursement SLA
- auto-reassignment for inactivity
- auto-close or auto-dead rules
- customer follow-up scheduling

## 16. Current workflow risks and inconsistencies

1. The main Loan Executive status endpoint accepts broad target statuses without enforcing the declared source-to-target transition matrix.
2. Bank Manager reassignment resets lead status to New and lacks a separate Rejected/Disbursed terminal guard.
3. Rejected and Disbursed are not immutable; remarks and bank documents can still change while the lead is not dead.
4. Disbursed can be saved without mandatory amount/date/UTR/sanction evidence.
5. Pending/Documents Received statuses are not validated against actual uploaded files.
6. No-response cases remain indefinitely without SLA, reminder or escalation.
7. Closed exists but is effectively unreachable from current web workflow.
8. Approval exists internally but is hidden under Under Bank Process.
9. Automatic assignment may leave status as New; ownership and lifecycle status are visually conflated.
10. Dedicated reject and generic status APIs generate different validation and downstream effects.
11. Notification, timeline, cache and SSE decisions are distributed across controllers and services.
12. Separate status API and sanction upload can leave a Disbursed case without its sanction document.
13. Dead Case is an overlay, so analytics must consistently exclude `isDeadCase:true` to avoid counting archived cases under their preserved status.
14. Mobile client behavior cannot be independently certified without its source repository.

## 17. Current workflow conclusion

CarLoanSaathi currently supports the complete operational path needed to create, assign, process, document, reject, disburse and archive loan leads. Authorization, ownership scoping, projections, Firestore indexes, notifications, timeline, audit, SSE, analytics and commissions are all present.

However, the workflow is user-driven rather than SLA-driven. Nothing automatically happens when a Loan Executive stops responding. Rejection and disbursement are reporting outcomes, but they are not consistently enforced as immutable terminal states. Business rules and downstream side effects remain distributed across multiple endpoints.

This document is an audit only. No workflow recommendation has been implemented and no application code was changed.
