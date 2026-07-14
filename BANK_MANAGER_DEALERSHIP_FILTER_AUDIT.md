# Bank Manager Dealership Filter Audit

## Certification

**GREEN — the Bank Manager dealership dropdown and activity table now use only the canonical dealership registration name, while filtering continues to use the stable `dealershipId`.**

## Root cause

The Bank Manager dealership aggregation was originally seeded from lead snapshots. Those snapshots contain dealership fields alongside Finance Manager, GM, salesperson, and assignment fields and can retain historical or incorrectly populated display values. The frontend then accepted `dealerName`, email, or record ID as label fallbacks. Consequently, an employee-derived value such as a Finance Manager name could become the dropdown label even though the internal dealership relationship was correct.

## Corrected data flow

```text
Bank-scoped lead/projection
  -> dealershipId
  -> batched canonical dealerships document lookup
  -> registered dealershipName DTO
  -> frontend option label
```

The option value remains `dealershipId`; the displayed text is only `dealershipName`.

## Backend changes

- Added bounded `getRecordsByIds()` support using Firestore `getAll()` in chunks of 100.
- Canonicalized projected and fallback dealership summaries using the `dealerships` registration collection.
- Removed lead/employee-derived dealership-name fallbacks from projection creation.
- Canonicalized disbursed-case responses on both projection and fallback paths.
- Excluded deleted or unresolved registration documents rather than displaying an employee or email fallback.
- Deduplicated results by normalized `dealershipId`.

## Frontend changes

- Dropdown labels use only `dealership.dealershipName`.
- Table dealership cells use only `dealership.dealershipName`.
- Option values and filtering use `dealershipId`.
- Invalid rows without a canonical name are not rendered as selectable options.

## Firestore and performance impact

- The normal list path remains projection-first and bank-scoped.
- Canonical registration records are loaded in one batched operation per page, not one query per dealership.
- Reads are bounded by the page size and chunked at 100 document references.
- No global dealership scan or cross-bank query was introduced.
- Existing 20-second bank/identity/page cache remains active.

## Security validation

The route remains restricted to `bank-manager`. The dealership projection query remains filtered by the authenticated bank identity before canonical enrichment. Canonical lookups are performed only for dealership IDs already present in that bank-scoped result, so another bank's relationship data is not exposed.

## Scenario validation

- One or multiple dealerships: canonical names returned.
- Multiple or renamed Finance Managers: label unchanged.
- Finance Manager deletion: label unchanged.
- Dealership rename: next canonicalized response reflects the registration name.
- Inactive dealership: registered identity remains stable when still bank-related.
- Deleted dealership: excluded because no canonical registration exists.
- Duplicate projection rows: collapsed by `dealershipId`.
- Large banks: cursor-bounded projections plus batched canonical reads avoid N+1 access.

## Before vs. after

| Concern | Before | After |
|---|---|---|
| Dropdown label | Lead snapshot with employee/email fallbacks | Registered `dealershipName` only |
| Filter identity | Dealership relationship field | Stable `dealershipId` |
| Rename handling | Could retain stale snapshot name | Canonical name resolved per response |
| Duplicate entries | Depended on aggregation quality | Deduplicated by `dealershipId` |
| Firestore access | Projection/lead snapshot only | Projection plus bounded batch canonical lookup |
| Bank isolation | Bank-scoped | Preserved before enrichment |

## Files changed

- `backend/services/firestoreCore.service.js`
- `backend/services/firestoreCrud.service.js`
- `backend/services/projectionBankDealership.service.js`
- `backend/controllers/bankShared.controller.js`
- `backend/controllers/bankLeadRead.controller.js`
- `frontend/src/pages/bank/BankDealershipPages.jsx`
- `backend/tests/bankDealershipCanonicalIdentity.test.js`
- `backend/tests/paginationContracts.test.js`

No authentication architecture, business workflow, assignment logic, or API route was changed.
