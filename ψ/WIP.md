# WIP — 2026-08-10 14:39

## Git Status

```text
 M src/app/orders/page.tsx
 M src/lib/purchase-order-suggestions.ts
 M ψ/WIP.md
?? ψ/memory/retrospectives/2026-08/10/14.39_labstock-14day-reorder-current-stock-plan.md
```

## งานค้าง

- [x] Validate the uncommitted 14-day recommendation formula with policy, no-policy, sufficient-stock, zero-usage, and pack-rounding cases.
- [x] Implement current-stock and minimum-threshold visibility in the `/orders` reagent picker and selected rows.
- [x] Run TypeScript, ESLint, production build, `git diff --check`, and an unauthenticated local `/orders` HTTP smoke test.
- [ ] Run an authenticated browser smoke test when a connected browser/session is available.
- [ ] Add LINE LIFF stock visibility after desktop acceptance.
- [x] Complete targeted Local RAG rescan and citation-bearing retrieval.

## Context

- `purchase-order-suggestions.ts` now uses positive `เบิกไปหน้างาน` records from the latest 14 calendar days for the demand projection and reorder trigger. An explicit `approved_order_qty_boxes` remains the authoritative order quantity; the calculated 14-day quantity is used only when no approved quantity exists.
- `/api/dashboard` already returns current `quantity` and `minThreshold`; `/orders` now preserves and displays both values without changing the purchase-order payload or database schema.
- Formula checks, TypeScript, ESLint, production build, diff check, and local HTTP `/orders` 200 all pass. Browser discovery returned no connected browser, so authenticated UI behavior is not yet verified.
- Commit and push were explicitly authorized on 2026-08-10. Do not deploy until authenticated UI/browser validation is complete.
