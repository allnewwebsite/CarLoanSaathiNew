# Dealership Onboarding And Subscription Flow

## Implemented Paths

```mermaid
flowchart TD
  A[Public CTA] --> B{Selected plan}
  B -->|TRIAL| C[Dealership registration]
  B -->|PROFESSIONAL| C
  C --> D[Pending Super Admin approval]
  D -->|Rejected| E[Rejected status screen]
  D -->|Approved + TRIAL| F[Create 60-day trial entitlement]
  D -->|Approved + PROFESSIONAL| G[Create payment-pending entitlement]
  F --> H[Main website login]
  G --> H
  H --> I{Dashboard entitlement}
  I -->|Trial active| J[Dashboard]
  I -->|Paid active| J
  I -->|Payment pending| K[Professional activation screen]
  I -->|Expired| L[Renewal screen]
  K --> M[Razorpay order and verified payment]
  L --> M
  M --> N[Invoice and paid subscription]
  N --> J
```

## Access Invariants

- `selectedPlan` is stored as `TRIAL` or `PROFESSIONAL` on new registration records.
- Existing records without `selectedPlan` remain backward-compatible and resolve to `TRIAL`.
- Professional approval never creates trial dates.
- Dashboard access requires an active trial or paid entitlement.
- Billing endpoints remain reachable while dashboard APIs remain blocked.
- Payment continues through the existing Razorpay order, verification, webhook, and invoice services.

## Screenshot Evidence

- `professional-payment-pending-desktop.png`
- `professional-payment-pending-mobile.png`
- `subscription-expired-desktop.png`
- `subscription-expired-mobile.png`

## Verification

- Backend JavaScript syntax checks passed.
- Subscription billing regression script passed.
- Frontend ESLint passed.
- Frontend production build passed.
