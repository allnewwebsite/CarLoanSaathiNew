# CarLoanSaathi Enterprise Automation Engine Report

## Certification

Implementation status: **YELLOW - code complete; production lifecycle drill required**.

The web and backend implementation is complete and passes the local automated checks. Production certification remains yellow until an authenticated staging drill proves Redis worker execution, notification/WhatsApp delivery, Firestore and Storage deletion, and portal synchronization using deployed services.

## Before and After Architecture

Before, assignment, status, Dead Case, search, queue, and scheduler services existed independently without one lifecycle policy defining acceptance, inactivity, terminal visibility, and retention deadlines.

After, `automationPolicy.service.js` is the single timing and lifecycle policy. `automationEngine.service.js` orchestrates the existing assignment, Dead Case, notification, WhatsApp, projection, cache, Firestore, Storage, Redis queue, and scheduler services. No new API, status system, scheduler framework, or Firestore collection was created.

## Automated Workflow

1. Assignment records a pending ownership state and a five-calendar-hour acceptance deadline.
2. The Loan Executive sees **Accept Lead**. Acceptance confirms ownership and cancels the deadline.
3. An expired unaccepted assignment uses the existing branch-aware reassignment engine, notifies the previous and next executive, sends the existing assignment WhatsApp, and starts a fresh five-hour deadline.
4. An accepted lead with no workflow status action for seven calendar days enters the existing Dead Case module.
5. Rejected and Disbursed cases remain in the active workflow for seven calendar days, then appear under **More > Rejected** or **More > Disbursed** in every web portal.
6. Authorized lifecycle-wide search includes Dead, Rejected, and Disbursed cases and returns their current location. Ordinary active-list search remains backward compatible.
7. Dead, Rejected, and Disbursed cases become due for permanent deletion exactly three calendar months from their original lifecycle timestamp. The scheduled worker processes due records in bounded batches.

## Deletion Design

Deletion is retryable and idempotent. It marks deletion in progress, removes Storage objects and document metadata, projections, assignments, timeline, notifications, view records, analytics references, audit/history records and caches, then deletes the canonical lead last. Failures leave the canonical record available for the next retry.

Firestore cannot provide one ACID transaction spanning Firebase Storage and Redis. Therefore literal cross-system atomic deletion is technically impossible with the current platform services. The implementation uses the safest achievable pattern: idempotent ordered deletion, bounded retries, and canonical-record-last removal. This limitation is the reason production certification remains yellow until a deployed failure-injection drill confirms that retries leave no orphans.

## Performance and Security

- Reuses the existing BullMQ/Redis queue with one automation worker and one existing scheduler registry.
- Uses bounded scans and local deadline filtering, avoiding new composite-index dependencies.
- Uses existing scoped assignment candidates, authorization, Dead Case rules, notifications, projections, realtime events, and caches.
- Does not expose a new mutation endpoint or introduce a new status.
- Global search continues to enforce the caller's existing tenant and ownership scope.

## Migration

No separate migration command is required. The automation worker incrementally backfills missing deadline and retention metadata on existing lead documents in bounded batches. New assignments and terminal/dead transitions write the metadata immediately.

Production requires `ENABLE_SCHEDULED_OPERATIONS=true`. `REDIS_URL` is recommended so the shared worker runs consistently across multiple instances; without Redis the existing in-process queue fallback is used.

## Validation

- Backend: `npm test` - 72/72 passing.
- Frontend: `npm run lint` - passing.
- Frontend: `npm run build` - production build passing.
- Diff integrity: `git diff --check` - passing.

## Files Added

- `backend/services/automationPolicy.service.js`
- `backend/services/automationEngine.service.js`
- `backend/tests/automationPolicy.test.js`
- `ENTERPRISE_AUTOMATION_ENGINE_REPORT.md`

## Existing Areas Extended

- Bank workflow acceptance and status persistence
- Lead status persistence
- Branch-aware executive assignment
- Existing Dead Case lifecycle
- Lead and projection query services
- BullMQ queue workers and scheduler registry
- Shared portal navigation and status location display
- Finance, GM, Bank Manager, Loan Executive, and Super Admin list filters

## Production Gate

Run one authenticated staging lifecycle drill with accelerated test intervals and synthetic records. Confirm acceptance, reassignment, both notification channels, seven-day routing behavior, lifecycle-wide search, deletion retry after injected Storage failure, cache/projection removal, and zero orphan records. Restore production intervals before rollout.
