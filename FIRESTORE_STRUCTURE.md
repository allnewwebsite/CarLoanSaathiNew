# Firestore Structure

CarLoanSaathi uses Firestore behind Express APIs only.

## Collections

### `leads`

Stores customer/dealer lead records.

Important fields:

- `fullName`
- `mobile`
- `city`
- `selectedBrand`
- `selectedModel`
- `carPrice`
- `loanAmount`
- `employmentType`
- `preferredBank`
- `status`
- `dealerEmail`
- `assignedPartnerId`
- `bankPartner`
- `assignmentStatus`
- `lastAssignedPartner`
- `assignmentTimestamp`
- `assignmentHistory`

### `leadAssignments`

Stores each partner assignment attempt.

- `leadId`
- `partnerId`
- `partnerName`
- `status`
- `reason`
- `assignmentTimestamp`
- `expiredAt`

### `reassignmentLogs`

Append-only lead retrieval/reassignment audit trail.

- `leadId`
- `fromPartnerId`
- `reason`
- `requestedBy`
- `status`

### `dealers`

Dealer account/profile records keyed by dealer email.

### `dealerProfiles`

Current profile records used by the dealer dashboard API.

### `bankPartners`

Bank partner configuration and eligibility fields.

- `name`
- `bankName`
- `active`
- `approved`
- `frozen`
- `supportedCities`
- `supportedBrands`
- `supportedBanks`
- `maxActiveLeads`

### `payouts`

Dealer payout records.

- `leadId`
- `commissionId`
- `dealerEmail`
- `amount`
- `status`: `pending`, `processing`, `released`

### `commissions`

Dealer commission records.

- `leadId`
- `dealerEmail`
- `amount`
- `percentage`
- `status`

### `settings`

Workflow configuration. Main document id:

- `workflow`

Fields:

- `idleReassignMinutes`
- `maxActiveLeadsPerPartner`
- `defaultCommissionPercent`
- `assignmentRules`

### `partnerQueues`

Round-robin queue state.

- `queueKey`
- `lastAssignedPartner`
- `lastAssignedLead`
- `lastAssignedAt`

### `notifications`

System and admin notifications.

- `type`
- `title`
- `message`
- `leadId`
- `partnerId`
- `dealerEmail`
- `admin`
- `read`

## Payout Logic

When a dealer lead is approved:

1. A commission record is created with `pending` status.
2. A payout record is created with `pending` status.

When the lead is disbursed:

1. Commission moves to `released`.
2. Payout moves to `released`.

Commission percentage is controlled by `settings/workflow.defaultCommissionPercent`.
