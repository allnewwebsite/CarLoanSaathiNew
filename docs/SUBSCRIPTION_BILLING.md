# Subscription and Billing

## Commercial Rules

- Plan: CarLoanSaathi Professional
- Base price: Rs. 15,000
- GST: 18% by default
- Payable amount: Rs. 17,700
- Trial: 60 days from Super Admin approval
- Paid validity: 30 days per successful manual payment
- Renewal: manual Razorpay Checkout only
- Expiry effect: only new lead creation is blocked
- Refund policy: no refunds after successful capture and subscription activation

## Firestore Collections

| Collection | Purpose | Primary lookup |
| --- | --- | --- |
| `dealershipSubscriptions` | Current entitlement for one dealership | Document ID is normalized dealership login email |
| `subscriptionOrders` | Server-created Razorpay orders | Razorpay order ID |
| `subscriptionPayments` | Verified captured payments | Razorpay payment ID |
| `subscriptionInvoices` | Immutable invoice data | Generated invoice number |
| `subscriptionWarnings` | Idempotency record for 7, 3, and 1 day warnings | Hashed dealership/end date/day key |
| `subscriptionPaymentActivations` | Durable single-activation marker and repair snapshot | Razorpay payment ID |
| `razorpayWebhookEvents` | Signed webhook delivery and processing audit | `X-Razorpay-Event-Id` |
| `razorpayWebhookHealth` | Last webhook success/failure health state | `current` |
| `paymentReconciliationHealth` | Last scheduled reconciliation result | `current` |

Subscription documents also expose a summary on existing dealership records for administrative views. Lead creation checks the single current subscription document and never scans leads or billing history.

## API Endpoints

Finance Desk:

- `GET /api/dealer/billing`
- `GET /api/dealer/billing/history`
- `POST /api/dealer/billing/order`
- `POST /api/dealer/billing/verify`

Razorpay:

- `POST /api/webhooks/razorpay`

Super Admin:

- `GET /api/admin/subscriptions/:dealershipId`
- `POST /api/admin/subscriptions/:dealershipId/extend`
- `POST /api/admin/subscriptions/:dealershipId/trial`
- `POST /api/admin/subscriptions/:dealershipId/suspend`

## Payment Security

The backend creates the Razorpay order. On checkout success it:

1. Verifies the HMAC signature using `RAZORPAY_KEY_SECRET`.
2. Reads the payment from Razorpay.
3. Captures an authorized payment when required.
4. Confirms order ID, amount, currency, and `captured` status.
5. Uses a Firestore transaction to create the payment and invoice and extend access.
6. Uses the Razorpay payment ID as the idempotency key.

For `payment.captured`, Razorpay can also call the webhook endpoint. The webhook validates the `X-Razorpay-Signature` HMAC against the unmodified raw request body using `RAZORPAY_WEBHOOK_SECRET`, finds the server-created order, and executes the same Firestore renewal transaction as frontend verification. Whichever path commits first wins; the second path returns an idempotent result without extending access or creating another payment or invoice.

Every 15 minutes, and once during backend startup, reconciliation checks recent `CREATED` and `PENDING` orders against Razorpay. Captured payments are passed through the same activation transaction. Paid orders are also checked for missing activation, payment, or invoice records, with operational alerts raised for inconsistent states.

No Razorpay secret is returned to the browser or stored in frontend code.

## Production Environment

Set these on the Render backend service:

```text
ENABLE_SUBSCRIPTION_BILLING=true
RAZORPAY_KEY_ID=<live key id>
RAZORPAY_KEY_SECRET=<live key secret>
RAZORPAY_WEBHOOK_SECRET=<separate webhook signing secret>
SUBSCRIPTION_GST_RATE=18
ENABLE_SCHEDULED_OPERATIONS=true
SUBSCRIPTION_LIFECYCLE_INTERVAL_MS=21600000
PAYMENT_RECONCILIATION_INTERVAL_MS=900000
PAYMENT_RECONCILIATION_LOOKBACK_HOURS=168
PAYMENT_RECONCILIATION_BATCH_SIZE=50
ENABLE_PAYMENT_RECONCILIATION=true
BILLING_RATE_LIMIT_MAX=10
```

Use Razorpay test keys in staging and live keys only in production.

## Deployment Order

1. Configure the backend environment variables.
2. Deploy Firestore rules and indexes.
3. Deploy the backend.
4. Deploy the frontend.
5. Run the backfill in dry-run mode and inspect the counts:

```powershell
npm run backfill:subscriptions
```

6. Apply the backfill only after the dry-run is correct:

```powershell
$env:APPLY_SUBSCRIPTION_BACKFILL="true"
npm run backfill:subscriptions
```

Existing approved dealerships use their recorded approval date as the trial start. If a legacy record has no approval timestamp, the migration starts its trial when the backfill runs instead of incorrectly using its registration date. Review the dry-run before applying it.

## Operational Checks

- Approve a new dealership and confirm a 60-day trial.
- Verify Finance Desk sees Plan & Billing while GM does not.
- Complete one Razorpay test payment and confirm one payment, one invoice, and 30 added days.
- Retry the same verification callback and confirm no second invoice is created.
- Deliver the same `payment.captured` webhook repeatedly and confirm the subscription is extended only once.
- Confirm `checks.razorpayWebhook` is healthy in `/health` and `/health/deep`.
- Confirm `checks.paymentReconciliation` reports a successful recent run.
- Set a test subscription to expire and confirm only lead creation returns `SUBSCRIPTION_EXPIRED`.
- Confirm existing leads, documents, analytics, login, and notifications remain available.
- Confirm subscription SSE events refresh open Finance Desk and Admin views.
