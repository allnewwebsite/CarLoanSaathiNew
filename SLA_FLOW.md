# SLA Flow

CarLoanSaathi tracks every assigned lead through an SLA lifecycle in `slaLogs`.

## SLA Statuses

- `pending`: lead assigned, waiting for bank partner acceptance
- `accepted`: partner accepted the lead
- `in-progress`: partner is processing the lead
- `document-requested`: partner requested missing/corrected documents
- `approved`: loan approved or disbursed
- `rejected`: partner rejected the lead
- `expired`: partner missed acceptance or idle SLA

## Timers

SLA settings are stored in `settings/workflow`:

- `slaAcceptMinutes`: partner must accept within this window
- `idleReassignMinutes`: accepted/in-progress leads cannot remain idle beyond this window
- `minSlaScore`: minimum partner score for eligibility
- `maxActiveLeadsPerPartner`: assignment capacity guard

The backend SLA engine runs periodically from `server.js` unless `DISABLE_SLA_ENGINE=true`.

## Breach Handling

When a pending or idle assignment breaches SLA:

1. Current `leadAssignments` record is marked `expired`.
2. Matching `slaLogs` record is marked `expired`.
3. A `sla-breach` notification is written for admin.
4. A `reassignmentLogs` entry is written.
5. The lead is returned to queue and assigned to the next eligible bank partner.

## SLA Metrics

Each SLA log may track:

- `responseTimeMinutes`
- `processingTimeMinutes`
- `approvalRatio`
- `rejectionRatio`
- `slaScore`

The current scoring starts from `100` and penalizes delayed response, long processing, rejection, and expiration.
