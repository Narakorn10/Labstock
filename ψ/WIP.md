# WIP — 2026-08-10 16:28

## Git Status

```text
 M package-lock.json
 M package.json
 M src/app/api/liff/orders/route.ts
 M src/app/api/purchase-orders/route.ts
 M src/app/api/purchase-orders/suggest/route.ts
 M src/app/master/permissions/page.tsx
 M src/app/orders/page.tsx
 M src/components/liff-order-workflow.tsx
 M src/lib/menu-config.ts
 M src/lib/purchase-order-suggestions.ts
 M src/lib/purchase-order-workflow.ts
 M ψ/WIP.md
?? src/app/api/settings/reagent-orders/
?? src/app/settings/reagent-orders/
?? src/lib/purchase-order-concurrency.test.ts
?? src/lib/purchase-order-creation.test.ts
?? src/lib/purchase-order-creation.ts
?? src/lib/purchase-order-suggestions.test.ts
?? src/lib/purchase-order-workflow.test.ts
?? upgrade_v17_reagent_order_suggestion_v5.sql
?? ψ/memory/retrospectives/2026-08/10/16.28_labstock-reagent-order-suggestion-v5.md
```

## งานค้าง

- [ ] Apply v17 only on an authorized Neon staging branch; verify idempotency, audit rollback, and concurrent PO `409` behavior.
- [ ] Admin-review the 51 retained policies and real ISE consumables; confirm source Excel before entering tests/box, average, or IQC.
- [ ] Run authenticated desktop/LIFF v5 smoke tests, compare v4/v5, then request separate commit/push/migration/deploy approval.

## Context

- V5 is implemented locally and uncommitted; 50 Vitest tests, TypeScript, ESLint, production build, diff check, local HTTP checks, and Local RAG rescan/retrieval passed.
- Server recalculates PO lines, stores basis/snapshot/reason, and uses advisory locks plus pending-PO snapshot checks; migration has not been applied anywhere.
- Production remains blocked on authorized staging, Admin policy/Excel review, and authenticated desktop/LIFF acceptance.
