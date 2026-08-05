# WIP — 2026-08-05 23:23

## Git Status

```text
c3ac623 feat: deliver LabStock UX UI phases
 M src/app/api/auth/google-token/route.ts
 M src/app/api/auth/login/route.ts
 M src/app/login/page.tsx
 M src/components/auth-provider.tsx
 M src/lib/auth-utils.ts
 M src/lib/line-liff-auth.ts
?? src/app/api/auth/register/
?? src/app/register/
?? upgrade_v16_email_auth_registration.sql
?? ψ/memory/retrospectives/2026-08/05/23.23_labstock-email-auth-registration.md
```

## งานค้าง

- [ ] Apply and verify `upgrade_v16_email_auth_registration.sql` in a non-production database.
- [ ] Build Admin approval/rejection UI and API for pending accounts.
- [ ] Add email verification and forgot/reset-password flows.
- [ ] Run authenticated browser smoke tests for Lab and Vendor registration/login.

## Context

- Email Auth Phase 1 is implemented but intentionally uncommitted and unpushed.
- Registration creates only `User` or `Vendor` accounts with `pending` status; vendor names are validated against approved companies.
- Password, Google, LINE, and bearer-token paths deny non-active accounts after the status column exists.
- Lint, TypeScript, diff-check, and production build passed locally.
- Do not open public enrollment until migration, approval controls, email verification, and reset-password flows are complete.
