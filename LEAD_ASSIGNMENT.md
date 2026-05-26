# Lead Assignment

All lead routing follows API-first architecture:

Frontend -> Express API -> Service Layer -> Firestore

The frontend never queries Firestore directly.

## Lead Lifecycle

1. Customer or dealer submits a lead.
2. Backend validates and stores the lead in `leads`.
3. `assignLeadRoundRobin` evaluates eligible bank partners.
4. Lead assignment is stored in `leadAssignments`.
5. Queue rotation is stored in `partnerQueues`.
6. SLA tracking begins in `slaLogs`.
7. Notifications are written to `notifications`.

## Eligibility Engine

A bank partner can receive a lead only when:

- account is active
- admin approval is present
- partner is not frozen
- customer city is supported
- selected car brand is supported
- selected/preferred bank is supported
- SLA score is above threshold
- active lead limit is not exceeded

Fallback local partners are derived from available bank logos for development. Production should store real partner records in `bankPartners`.

## Round Robin Logic

Queue keys are built from:

```txt
city:selectedBrand:preferredBank
```

The queue record in `partnerQueues` stores:

- `lastAssignedPartner`
- `lastAssignedLead`
- `lastAssignedAt`

Each new eligible lead moves to the next partner in sequence, keeping distribution fair inside that queue.

## Reassignment Flow

Leads are retrieved and reassigned when:

- partner is inactive or frozen
- SLA acceptance window expires
- lead is idle too long
- partner rejects the lead
- admin manually triggers reassignment

Reassignment writes:

- expired/closed assignment in `leadAssignments`
- `reassignmentLogs`
- notification
- new round-robin assignment if an eligible partner exists

## Admin Controls

Super Admin APIs support:

- manual reassignment
- SLA settings
- partner freeze/unfreeze
- assignment rules
- partner lead limits
- payout percentages
- workflow log viewing
