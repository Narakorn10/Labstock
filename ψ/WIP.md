# WIP — 2026-08-10 19:16

## Git Status

```text
clean on agent/reagent-order-suggestions
```

## งานค้าง

- [ ] Apply v17 only on an authorized Neon staging branch; verify idempotency, audit rollback, and concurrent PO `409` behavior.
- [ ] Admin-review the 51 retained policies and real ISE consumables; confirm source Excel before entering tests/box, average, or IQC.
- [ ] Run authenticated desktop/LIFF v5 smoke tests and compare v4/v5 before Production promotion.

## Context

- V5 implementation was committed as `74e88d8` and pushed to `origin/agent/reagent-order-suggestions` with 50 Vitest tests, TypeScript, ESLint, production build, and diff checks passing.
- Vercel preview deployment `dpl_J5HhWi7pKNM95vKLYiNAttLPawZe` is `READY` at `https://labstock-mydusjwpr-narakorn10s-projects.vercel.app`; protected preview smoke returned HTTP 200 for `/` and HTTP 401 for the unauthenticated Admin API.
- Migration v17 has not been applied. Production remains blocked on authorized staging, Admin policy/Excel review, and authenticated desktop/LIFF acceptance.
