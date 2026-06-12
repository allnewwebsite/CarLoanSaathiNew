# Enterprise Authorization Audit

## Security Model

CarLoanSaathi uses zero-trust authorization:

- Frontend routes improve UX but are not trusted for security.
- Backend APIs are authoritative.
- Firestore and Storage rules provide a second isolation layer for direct client access.
- Every authenticated request re-loads the authoritative user record from Firestore.
- Role, approval state, active state, dealershipId, and bankId come from backend-verified account data.

## Portal Boundaries

| Portal | Route | Allowed Role |
| --- | --- | --- |
| Finance Desk | `/finance/*` | `finance-desk` |
| GM | `/gm/*` | `gm` |
| Bank Manager | `/bank-manager/*` | `bank-manager` |
| Loan Executive | `/loan-executive/*` | `loan-executive` |
| Super Admin | `/admin/*` | `super-admin` |

Super Admin no longer bypasses every protected frontend route. Super Admin uses `/admin/*` and admin APIs only.

## Backend Route Boundaries

| API Group | Middleware |
| --- | --- |
| `/api/dealer/*` | `authenticate` + `requireRole(finance-desk)` |
| `/api/gm/*` | `authenticate` + `requireRole(gm)` |
| `/api/bank/*` | `authenticate` + `requireRole(bank-manager, loan-executive)` plus action-level role checks |
| `/api/admin/*` | `authenticate` + `requireRole(super-admin)` |
| `/api/documents/upload` | `authenticate` + `requireRole(finance-desk)` plus lead ownership check |
| `/api/documents/:id/status` | `authenticate` + `requireRole(loan-executive)` plus assigned-lead check |
| `/api/notifications/*` | `authenticate` plus recipient/tenant scope checks |

The backend role guard no longer has a wildcard Super Admin bypass. Admin access must be explicitly requested by routes that pass `super-admin`.

## Tenant Isolation

| Role | Data Scope |
| --- | --- |
| `finance-desk` | `lead.dealershipId == user.dealershipId` |
| `gm` | `lead.dealershipId == user.dealershipId` |
| `bank-manager` | `lead.bankId == user.bankId` |
| `loan-executive` | `lead.assignedExecutiveId == user.uid/email` |
| `super-admin` | Admin APIs and admin Firestore rules |

Search, pagination, dashboard, document, and notification reads must retain these scopes.

## Firestore Rules Findings

Hardened:

- Default deny remains active.
- Audit logs, operational events, notification events, counters, metrics, archived leads, and archival logs are client-read/write restricted.
- User self-update cannot mutate role, approval, active state, account status, dealershipId, or bankId.
- Lead reads are role and tenant scoped.
- Document reads are tenant or assignment scoped.

## Storage Rules Findings

Hardened:

- Default deny remains active.
- Customer files require auth, approved account, file size under 10 MB, and allowed MIME type.
- Finance uploads require matching `dealershipId` metadata.
- Reads require same dealership, same bank, assigned executive, or Super Admin.
- Backend-generated signed URLs remain preferred for document viewing.

## Attack Scenarios Covered

- Manual `/finance/*` URL access by GM: redirected by frontend, blocked by backend.
- Manual `/gm/*` URL access by Finance Desk: redirected by frontend, blocked by backend.
- Super Admin trying `/bank-manager/*`: redirected to `/admin/dashboard`, blocked by bank APIs.
- Direct bank API call by Finance Desk: `403 ROLE_FORBIDDEN`.
- Direct finance API call by GM: `403 ROLE_FORBIDDEN`.
- Cross-dealership lead query: blocked by scoped backend query and Firestore rules.
- Cross-bank lead query: blocked by scoped backend query and Firestore rules.
- Notification enumeration: blocked by recipient/tenant checks.
- Document enumeration: blocked by lead/document ownership checks and Storage rules.
- User self privilege escalation: blocked by Firestore immutable security fields and backend authoritative account reload.

## Verification Command

Run before every push:

```powershell
npm run security:scan
npm run security:authz-audit
```

## Production Checklist

- Deploy Firestore rules after this change.
- Deploy Storage rules after this change.
- Keep route guards and backend route middleware aligned.
- Never add `super-admin` as a blanket bypass to shared API middleware.
- New APIs must declare one of:
  - public intentionally
  - authenticated tenant scoped
  - exact role scoped
  - super-admin only
- New list APIs must use server-side tenant filters before pagination.
