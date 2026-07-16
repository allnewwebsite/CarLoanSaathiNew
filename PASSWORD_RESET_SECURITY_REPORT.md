# Password Reset Security Report

## Result

**GREEN — password reset email delivery is now gated by CarLoanSaathi account existence, exact login portal, active status, and Firebase identity.**

## Correct request flow

1. The login page submits normalized email plus its exact portal to `POST /api/auth/password-reset/validate`.
2. IP and normalized-email rate limiters independently enforce five attempts per hour by default.
3. CarLoanSaathi identity records are checked before Firebase is queried.
4. The registered role must belong to the requested login portal.
5. The CarLoanSaathi account must be active.
6. Firebase Authentication must contain the same verified identity and role linkage.
7. Only after the backend returns success does the frontend call Firebase `sendPasswordResetEmail`.

## Rejection behavior

- Unknown CarLoanSaathi email: `404 NO_ACCOUNT`; Firebase is not called.
- Wrong portal: `403 WRONG_PORTAL`; Firebase is not called.
- Inactive account: `403 ACCOUNT_DISABLED`; Firebase is not called.
- Missing Firebase identity: `404 NO_FIREBASE_ACCOUNT`; no reset email is sent.
- Identity mismatch: `403 IDENTITY_MISMATCH`; no reset email is sent.
- Rate exceeded by IP or email: `429 PASSWORD_RESET_RATE_LIMITED`.

## Portal coverage

- Finance Desk → `finance-desk`
- General Manager → `gm`
- Bank Manager → `bank-manager`
- Loan Executive → `loan-executive`
- Super Admin → `super-admin`

## Audit and privacy

Every validation outcome and rate-limit rejection records timestamp, normalized email identity, role when known, portal, IP, success/failure, and reason. Passwords, Firebase reset links, and reset tokens are neither accepted nor logged. Firebase owns action-code expiry and invalid-code handling; CarLoanSaathi does not create a parallel token format.

## Compatibility

Login, session, password-change, Firestore schema, and Firebase reset completion behavior are unchanged.
