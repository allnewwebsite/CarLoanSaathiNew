# CarLoanSaathi Final Production Workflow

CarLoanSaathi is a closed dealership-to-bank automotive finance ecosystem.

## Panels

- `GM / SM Tracking Panel`: view-only showroom, salesperson, finance desk, bank, conversion, aging, and business analytics.
- `Finance Desk Panel`: main operational workspace for lead creation, document upload, salesperson management, bank submission, follow-ups, EMI, sanction, and disbursement tracking.
- `Bank Branch Manager Panel`: branch queue monitoring, executive performance, workload balancing, manual reassignment, and escalation control.
- `Loan Executive Panel`: assigned-case processing, document verification, approvals, rejections, sanction upload, remarks, and disbursement updates.
- `Super Admin Panel`: hidden `/super-admin` login for the configured `SUPER_ADMIN_EMAIL`, with global controls for dealers, banks, branches, executives, routing, analytics, fraud, settings, and overrides.

## Public Routes

- `/`
- `/banks`
- `/apply-loan`
- `/dealer-registration`
- `/dealer-login`
- `/bank-login`
- `/super-admin` hidden, not linked in public navigation

## Dashboard Routes

- `/gm/dashboard`
- `/finance/dashboard`
- `/bank-manager/dashboard`
- `/loan-executive/dashboard`
- `/admin/dashboard`

Legacy dashboard routes redirect into the final route structure.

## Routing Rule

Lead routing is based on dealership registered city, not customer city.

```
Finance Desk sends lead
  -> dealership registered city
  -> matching bank branch city
  -> available branch executive
  -> assignment is visible to the selected executive
```

Reassignment stays inside the same bank branch. Only the Super Admin can override city routing manually.

## Firestore Collections

- `dealerships`
- `financeDesks`
- `salespersons`
- `banks`
- `branches`
- `branchManagers`
- `loanExecutives`
- `leads`
- `leadAssignments`
- `documents`
- `notifications`
- `notificationLogs`
- `whatsappQueue`
- `leadTimeline`
- `analytics`

Compatibility collections are retained where existing APIs already use them.

## Priority 1: Lead Timeline

Every important operational action writes an immutable `leadTimeline` entry. Entries include:

- lead id
- event type
- title and description
- actor id/name/role
- branch/dealership ids when available
- metadata
- visibility

Timeline APIs:

- `GET /api/timeline`
- `GET /api/timeline/leads/:leadId`

Supported filters:

- `date=today|yesterday|last7`
- `eventType`
- `status`
- `user`
- `search`
- `page`
- `limit`

Visibility:

- Finance Desk sees its complete lead timeline.
- GM/SM sees read-only dealership timeline.
- Loan Executive sees assigned lead timeline.
- Bank Manager sees branch timelines.
- Super Admin sees everything.

## Priority 2: WhatsApp Notifications

CarLoanSaathi uses WhatsApp only for operational alerts. Email and SMS are disabled by design.

Collections:

- `notifications`
- `notificationLogs`
- `whatsappQueue`

Notification APIs:

- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `POST /api/notifications/whatsapp/process` for Super Admin queue processing

Provider configuration:

- `WHATSAPP_PROVIDER=cloud-api|twilio`
- `WHATSAPP_CLOUD_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_DRY_RUN=true|false`

The queue supports retries, delivery logging, missing-phone tracking, and dry-run mode for production rollout testing.
