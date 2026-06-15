# Registration State Machine

CarLoanSaathi onboarding must follow the same state rules for dealerships and bank branches.

## States

- `EMAIL_PENDING`: Firebase account exists, but the email address is not verified. Registration forms and login must stay blocked.
- `EMAIL_VERIFIED`: Email is verified and the business registration form can be completed.
- `PENDING_APPROVAL`: Registration form has been submitted and is waiting for Super Admin approval.
- `APPROVED`: Super Admin approved the account. Login and dashboard access may proceed.
- `REJECTED`: Super Admin rejected the application. Login and dashboard access stay blocked.
- `SUSPENDED`: Super Admin suspended the application or approved account. Login and dashboard access stay blocked.
- `DEACTIVATED`: Account or business record is inactive/deleted. Login and dashboard access stay blocked.

## Required Transitions

1. Account created -> `EMAIL_PENDING`
2. Email verified -> `EMAIL_VERIFIED`
3. Registration submitted -> `PENDING_APPROVAL`
4. Admin approves -> `APPROVED`
5. Admin rejects -> `REJECTED`
6. Admin suspends -> `SUSPENDED`
7. Account disabled/deleted -> `DEACTIVATED`

## Hard Rules

- Backend submit endpoints must reject unverified Firebase email accounts.
- Login must reject unverified, pending, rejected, suspended, and deactivated accounts.
- Existing legacy fields may be ignored for old records, but new records must not require removed fields.
- Dealer registration routes must remain reachable by direct URL even when the public header hides dealership onboarding.
- Bank registration must not require or store GSTIN for new records.
