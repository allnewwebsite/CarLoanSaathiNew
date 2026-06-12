# CarLoanSaathi Production Security Guide

## Immediate Incident Response

1. Revoke and rotate every exposed secret in GitHub alerts:
   - Firebase Web API key
   - Firebase service account private key
   - JWT secret
   - Any SMTP, Render, Vercel, or third-party token
2. Delete old Firebase Admin service account keys in Google Cloud IAM.
3. Create a new Firebase Admin key and store it only in Render environment variables.
4. Invalidate old app sessions by changing `JWT_SECRET`; startup fails when this secret is missing or weak.
5. Review GitHub secret scanning alerts and mark them resolved only after rotation.

History cleanup must be done in the GitHub repository that received the alert. Use `git filter-repo` or BFG Repo-Cleaner, then force-push only after coordinating with collaborators.

## Backend Architecture

- `backend/config/env.js`: startup validation for strong JWT secret, Super Admin email, and production Firebase settings.
- `backend/config/firebaseAdmin.js`: ENV-only Firebase Admin singleton.
- `backend/middleware/auth.js`: verifies Firebase/JWT session, email verification, account status, and role context.
- `backend/middleware/requireRole.js`: centralized role authorization.
- `backend/middleware/roleGuard.js`: array-style RBAC and ownership helper.
- `backend/middleware/securityMiddleware.js`: Helmet, CORS, HTTPS enforcement, and rate limits.
- `backend/routes/lead.routes.js`: separates public loan intake (`/api/leads/public`) from authenticated finance-desk lead creation (`/api/leads/create`).
- `backend/services/audit.service.js`: enterprise audit event writer.
- `backend/services/notification.service.js`: in-app notification and notification log service.
- `backend/services/storage.service.js`: private document uploads and short-lived signed URLs.

## Frontend Auth Flow

1. User signs in with Firebase email/password.
2. Frontend blocks login if `emailVerified !== true`.
3. Frontend refreshes ID token.
4. Backend verifies token, role, approval, account status, and organization IDs.
5. Backend issues service JWT.
6. Logout clears Firebase auth, local storage, session cache, and auth context.

Forgot password first calls `/api/auth/password-reset/validate`; Firebase reset email is sent only after backend confirms the account exists, is active, and has verified email.

## Public Loan Intake Governance

Public applications must use `/api/leads/public`. This endpoint is rate-limited, App Check protected when `ENFORCE_APP_CHECK=true`, honeypot checked, schema validated, PII-safe logged, audited, and written as controlled intake with `publicIntake=true`.

Authenticated finance-desk creation remains on `/api/leads/create` and remains protected by `authenticate` plus `finance-desk` RBAC. Public intake must never create users, grant roles, assign executives, or bypass dealership/bank tenant isolation.

## Firestore Rules

`firestore.rules` is deny-by-default. Access is scoped by:

- `super-admin`: full access.
- `finance-desk` / `gm`: own `dealershipId`.
- `bank-manager`: own `bankId`.
- `loan-executive`: assigned leads only.

Protected collections include `users`, `leads`, `documents`, `notifications`, `auditLogs`, approval queues, dealerships, banks, and counters.

## Storage Rules

Customer files are private under:

```text
documents/leads/{CASE-ID}/{fileName}
```

Access is based on storage metadata:

- `dealershipId`
- `bankId`
- `assignedExecutiveId`
- `assignedExecutiveEmail`

Only allowed MIME types are PDF, JPEG, and PNG. Max size is 10 MB.

## Secure Environment Variables

Use placeholders in `.env.example` only. Never commit real `.env` files.

Backend required production variables:

- `NODE_ENV=production`
- `CLIENT_ORIGIN`
- `JWT_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_ACTION_CONTINUE_URL`

Frontend Vercel variables:

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_ACTION_CONTINUE_URL`

## Render Setup

1. Add all backend env vars in Render Dashboard.
2. Store multiline Firebase private key as escaped `\n` line breaks.
3. Set `NODE_ENV=production`.
4. Set `CLIENT_ORIGIN` to the Vercel production URL.
5. Set `JWT_SECRET` to a new 64+ character random value.
6. Do not upload service account JSON files.

## Vercel Setup

1. Add frontend variables in Vercel Project Settings.
2. Restrict Firebase authorized domains to production and known staging domains.
3. Keep Firebase client config in Vercel env vars only.

## Firebase Setup

1. Enable Email/Password Authentication.
2. Add authorized domains:
   - localhost for development
   - Vercel production domain
   - custom production domain
3. Configure email verification and password reset templates.
4. Set action URL to the production login URL.
5. Deploy Firestore and Storage rules.
6. Deploy Firestore indexes from `firestore.indexes.json`.

## Super Admin Creation

No public super-admin registration exists.

Set backend env vars:

```bash
SUPER_ADMIN_EMAIL=<your-super-admin-email>
SUPER_ADMIN_PASSWORD=replace-with-strong-one-time-password
FIREBASE_WEB_API_KEY=<firebase-web-api-key>
FIREBASE_ACTION_CONTINUE_URL=<frontend-super-admin-login-url>
```

Run:

```bash
npm run create-super-admin
```

The script blocks duplicate Firebase Auth users and creates `users/<your-super-admin-email>` with `role: super-admin`.

## GitHub Protection

- `.gitignore` blocks env files, service account files, keys, PEMs, uploads, build output, and Firebase local files.
- `scripts/scan-secrets.js` scans staged or full workspace content.
- `.husky/pre-commit` runs `npm run security:scan`.
- GitHub secret scanning must remain enabled.

## Production Checklist

- Rotate all leaked credentials.
- Remove secrets from git history.
- Deploy updated backend env vars to Render.
- Deploy updated frontend env vars to Vercel.
- Deploy Firestore rules.
- Deploy Storage rules.
- Deploy indexes.
- Run `npm run security:scan`.
- Run frontend build.
- Run backend syntax checks.
- Create and verify Super Admin account.
- Confirm login, password reset, document upload, document view, and role isolation.
