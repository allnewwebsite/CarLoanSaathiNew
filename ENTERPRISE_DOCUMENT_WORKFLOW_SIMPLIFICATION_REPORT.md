# Enterprise Document Workflow Simplification Report

## Certification

**GREEN — the document request lifecycle has one supported entry point, document uploads use a compact unified screen, and platform selects require an explicit choice.**

## Root cause

Loan Executive lists exposed a standalone **Request Docs** action and the document sheet exposed another **Request** action. Both opened the same checklist and called the lead-status API, duplicating the workflow already represented by **Update Status → Pending Documents**. The Finance Desk page also rendered one oversized drop area per document and did not present uploaded customer documents in one authoritative table.

## Before and after

Before:

1. Request Docs or Documents → Request
2. Separate pending-document modal
3. Status API call

Or:

1. Update Status
2. Pending Documents
3. A second document-selection path

After:

1. Loan Executive selects **Update Status**.
2. The default remains **Select Status** and is invalid for submission.
3. Selecting **Pending Documents** expands the official responsive checklist.
4. At least one document is required; Other requires a name; remarks are optional.
5. One PATCH updates the status and requested checklist through the existing authorization, audit, notification, timeline, projection, and SSE pipeline.

## Removed duplicate features

- Removed the Loan Executive table's standalone **Request Docs** action and column.
- Removed the document sheet's **Request** action.
- Removed the standalone `PendingDocsModal` component and its state/API submission path.
- Removed public copy describing a separate request-documents feature.
- No backend request API was removed because no duplicate backend request endpoint existed; both old UI paths already used the canonical status endpoint.

## Finance Desk redesign

The page order is now:

1. Pending Documents banner and executive remark
2. Customer Uploaded Documents table
3. Compact responsive upload grid
4. Bank Uploaded Documents

The customer table provides document, status, file/uploaded state, preview, download, upload time, and requester. Preview/download obtains a short-lived authorized URL. Cards use compact file controls, progress, upload/replace, remove, preview, and timestamp.

## Dropdown standardization

All JSX `<select>` controls now begin with an empty-value option. Creation/update fields use a `Select ...` prompt and required fields reject it through their existing validation or disabled submit behavior. Saved non-empty values remain supported. Optional filters retain their unfiltered empty value while displaying a consistent `Select ...` prompt.

## Backend, database, and migration

- The canonical bank lead-status endpoint remains the only request write pipeline.
- Finance uploads validate against `pendingDocumentsRequested` and legacy `pendingDocuments` when checklist metadata exists.
- Older records without a stored checklist remain uploadable, preserving existing data and providing automatic compatibility without a destructive migration.
- No schema migration, data rewrite, ownership change, authentication change, or permission expansion was introduced.

## Performance and duplicate prevention

- One modal and one request state tree replace two request entry paths.
- Pending-document submission performs one API request and one Firestore status update pipeline.
- Existing backend notification, audit, timeline, projection, and SSE generation remains centralized.
- The uploaded-document table reuses the existing document list request; preview URLs are fetched only on user action.

## Security verification

- Status updates remain restricted to Loan Executives by the existing bank route middleware and controller ownership checks.
- Finance uploads remain restricted to Finance Desk and matching dealership ownership.
- Finance Desk upload authority remains independent from the pending-document checklist; the checklist is informational and never disables or rejects an otherwise authorized upload.
- Short-lived document URLs remain protected by authenticated document read authorization.

## Files modified

- `frontend/src/pages/bank/LoanExecutiveLeadListPage.jsx`
- `frontend/src/pages/bank/LoanExecutiveLeadModals.jsx`
- `frontend/src/pages/dashboard/finance/FinanceLeadDocumentsPage.jsx`
- Platform select components under `frontend/src/components` and `frontend/src/pages`
- `frontend/src/pages/PartnerProgramPage.jsx`
- `backend/controllers/document.controller.js`
- `backend/tests/documentWorkflowContracts.test.js`

## Test evidence

The final command results are recorded in the implementation handoff. Required gates are backend tests, frontend tests, ESLint, production build, production invariant validation, Firestore index audit, and whitespace validation.
