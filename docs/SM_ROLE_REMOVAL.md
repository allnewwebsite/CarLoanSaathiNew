# SM Role Removal

CarLoanSaathi now uses `gm` as the only dealership management role. The legacy
values `gm-sm`, `sm`, and `sales manager` are rejected by application
authorization and user-creation validation.

## Production Migration

Run the migration before deploying the GM-only backend and Firestore rules:

```powershell
npm.cmd run migrate:sm-to-gm
$env:APPLY_SM_TO_GM_MIGRATION="true"
npm.cmd run migrate:sm-to-gm
Remove-Item Env:APPLY_SM_TO_GM_MIGRATION
```

The first command is a dry run. Review the generated JSON file under
`backend/migration-reports`. The apply run:

- converts active legacy dealership management records to `gm`;
- converts dealership manager display records to `General Manager`;
- updates notification role targets;
- revokes legacy sessions;
- updates Firebase custom claims and revokes refresh tokens;
- does not delete users.

Deploy the backend, frontend, Firestore rules, and indexes only after the apply
report has no migration errors.
