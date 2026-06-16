# API Contract Inventory

This inventory captures the core CarLoanSaathi API contracts that drive portal dashboards. It is intentionally focused on high-traffic operational endpoints first.

## Response Shapes

Current APIs use three shapes:

- Legacy raw record: `{ id, ...fields }`
- Legacy list/page: `{ data, total, limit, nextCursor, hasMore }` or raw array
- Standard envelope: `{ success, message, data, meta, pagination }`

Frontend code should read these through `frontend/src/services/apiResponse.js` while endpoints are migrated.

## Auth

| Endpoint | Roles | Shape | Frontend Consumers |
| --- | --- | --- | --- |
| `POST /api/auth/login` | public | `{ token, user, redirectTo }` | `AuthContext`, `LoginPage` |
| `GET /api/auth/session` | authenticated | `{ user, redirectTo }` | `AuthContext` |
| `POST /api/auth/session/refresh` | authenticated | `{ token, user }` | Axios interceptor |
| `POST /api/auth/logout` | authenticated | legacy success | `AuthContext` |
| `GET /api/auth/login-activity` | authenticated | list | `LoginActivityPage` |

## Lead Lists

| Endpoint | Roles | Query | Shape | Consumers |
| --- | --- | --- | --- | --- |
| `GET /api/dealer/leads` | `finance-desk` | `page`, `limit`, `cursor`, `status`, `search`, `salespersonId`, `financeManagerId` | page | `FinanceDeskPanel` |
| `GET /api/gm/leads` | `gm` | `page`, `limit`, `cursor`, `status`, `search`, `salespersonId` | page | `GmTrackingPanel` |
| `GET /api/bank/leads` | `bank-manager`, `loan-executive` | `page`, `limit`, `cursor`, `status`, `search` | page | `BankBranchManagerPanel`, `LoanExecutivePanel` |
| `GET /api/admin/leads` | `super-admin` | `page`, `limit`, `cursor`, `status`, `search` | page | `SuperAdminDashboard` |
| `GET /api/dealer/archived-leads` | `finance-desk` | `page`, `limit`, `cursor`, `status`, `search` | page | `ArchivedCasesPage` |
| `GET /api/admin/archived-leads` | `super-admin` | `page`, `limit`, `cursor`, `status`, `search` | page | `ArchivedCasesPage` |

Target page shape:

```json
{
  "data": [],
  "total": 0,
  "limit": 10,
  "nextCursor": null,
  "hasMore": false
}
```

## Lead Details And Documents

| Endpoint | Roles | Shape | Consumers |
| --- | --- | --- | --- |
| `GET /api/dealer/leads/:id` | `finance-desk` | lead record | Finance detail/document pages |
| `GET /api/gm/leads/:id` | `gm` | lead record | GM detail page |
| `GET /api/bank/leads/:id` | `bank-manager`, `loan-executive` | lead record | Bank and executive detail pages |
| `GET /api/admin/leads/:id` | `super-admin` | lead record | Admin lead detail |
| `GET /api/documents/lead/:leadId` | authorized lead readers | array | Finance document page |
| `POST /api/documents/upload` | `finance-desk` | document record | Finance document page |
| `POST /api/bank/leads/:id/documents` | `bank-manager`, `loan-executive` | document record | Bank/executive detail pages |

## Workflow Mutations

| Endpoint | Roles | Body | Shape | Side Effects |
| --- | --- | --- | --- | --- |
| `POST /api/dealer/leads` | `finance-desk` | lead form | lead record | projections, audit, timeline, analytics |
| `PATCH /api/bank/leads/:id/status` | `loan-executive` | `{ status, ... }` | lead record | projections, timeline, notification, WhatsApp, realtime |
| `PATCH /api/admin/leads/:id/status` | `super-admin` | `{ status }` | lead record | projections, audit, realtime |
| `PATCH /api/bank/leads/:id/reassign` | `bank-manager` | `{ reason, newExecutiveId }` | lead record | projection cleanup/sync, audit, realtime |
| `PATCH /api/bank/leads/:id/remarks` | `bank-manager`, `loan-executive` | remarks payload | lead record | timeline, realtime |

## Staff And Partner Catalogs

| Endpoint | Roles | Shape | Consumers |
| --- | --- | --- | --- |
| `GET /api/dealer/staff` | `finance-desk` | array | Finance staff management |
| `POST /api/dealer/staff` | `finance-desk` | staff record with credentials | Finance staff management |
| `GET /api/dealer/salespersons` | `finance-desk` | array | Finance screens |
| `GET /api/gm/salespersons` | `gm` | array | GM screens |
| `GET /api/dealer/finance-managers` | `finance-desk` | array | Finance screens |
| `GET /api/dealer/bank-tieups` | `finance-desk` | array | Finance bank tie-ups |
| `GET /api/bank/executives` | `bank-manager` | array | Bank manager screens |
| `GET /api/bank/dealerships` | `bank-manager` | page | Bank dealership screen |
| `GET /api/bank/dealerships/:dealershipId/disbursed` | `bank-manager` | page | Bank dealership disbursed screen |

## Admin Operations

| Endpoint | Roles | Shape | Consumers |
| --- | --- | --- | --- |
| `GET /api/admin/ecosystem` | `super-admin` | aggregate object | `SuperAdminDashboard` |
| `GET /api/admin/monitoring` | `super-admin` | monitoring object | `AdminMonitoringCenter` |
| `GET /api/admin/approvals/dealerships` | `super-admin` | page/list | Admin approvals |
| `GET /api/admin/approvals/banks` | `super-admin` | page/list | Admin approvals |
| `POST /api/admin/approvals/dealerships/:id/approve` | `super-admin` | action result | Admin approval detail |
| `POST /api/admin/approvals/banks/:id/approve` | `super-admin` | action result | Admin approval detail |
| `GET /api/admin/subscriptions/:dealershipId` | `super-admin` | subscription overview | Admin dealership detail |
| `POST /api/admin/subscriptions/:dealershipId/extend` | `super-admin` | action result | Admin subscription panel |

## Billing

| Endpoint | Roles | Shape | Consumers |
| --- | --- | --- | --- |
| `GET /api/dealer/billing` | `finance-desk` | billing overview | Plan billing modal/page |
| `GET /api/dealer/billing/history` | `finance-desk` | payment/invoice history | Plan billing page |
| `POST /api/dealer/billing/order` | `finance-desk` | Razorpay order bootstrap | Subscription payment service |
| `POST /api/dealer/billing/verify` | `finance-desk` | subscription activation result | Subscription payment service |
| `POST /api/webhooks/razorpay` | Razorpay | webhook acknowledgement | Razorpay |

## Migration Rules

1. Do not break legacy frontend consumers during contract cleanup.
2. New frontend code must use `normalizeRows`, `normalizeRecord`, or `normalizePagedResponse`.
3. New backend endpoints should use `res.success()` / `res.fail()`.
4. Lead-list endpoints should converge on the target page shape.
5. Contract tests should be added before changing any existing endpoint shape.
