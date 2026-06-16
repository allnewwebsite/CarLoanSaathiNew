# Staging E2E Playbook

The browser E2E suite is intentionally staging-only. It will skip write flows unless explicit gates are set.

## Install

```powershell
npm --prefix frontend install
npm --prefix frontend run e2e:install
```

## Required Environment

```powershell
$env:E2E_BASE_URL="https://your-staging-frontend.example.com"
$env:E2E_FINANCE_EMAIL="finance-test@example.com"
$env:E2E_FINANCE_PASSWORD="..."
$env:E2E_BANK_EMAIL="bank-manager-test@example.com"
$env:E2E_BANK_PASSWORD="..."
$env:E2E_ADMIN_EMAIL="admin-test@example.com"
$env:E2E_ADMIN_PASSWORD="..."
```

## Read/Login Smoke

```powershell
npm --prefix frontend run e2e:staging
```

## Registration Write Flow

Use a disposable email address in the staging Firebase project.

```powershell
$env:E2E_RUN_REGISTRATION="true"
$env:E2E_REGISTRATION_EMAIL="dealer-e2e-$(Get-Date -Format yyyyMMddHHmmss)@example.com"
$env:E2E_REGISTRATION_PASSWORD="ChangeMe123!"
npm --prefix frontend run e2e:staging -- tests/e2e/staging-registration.spec.js
```

## Lead Creation Write Flow

Use an approved staging finance account with at least one salesperson, one finance manager, and one tied-up bank branch.

```powershell
$env:E2E_CREATE_LEADS="true"
$env:E2E_LEAD_CITY="Gurugram"
npm --prefix frontend run e2e:staging -- tests/e2e/staging-lead-creation.spec.js
```

## Notes

- Never point these tests at production.
- Write flows create real staging records and should run against disposable test accounts.
- Playwright artifacts are kept on failure under `frontend/test-results` and `frontend/playwright-report`.
