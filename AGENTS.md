# Repository Guidelines

<!-- BEGIN:nextjs-agent-rules -->
This repository uses a Next.js build that may differ from common examples. Before changing framework-specific behavior, check the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

## Project Structure & Module Organization

Application routes live in `src/app/` with the App Router. Keep pages grouped by workflow such as `src/app/dispense/`, `src/app/receive/`, `src/app/count/`, `src/app/orders/`, and `src/app/vendor/`. API handlers belong in `src/app/api/`. Shared UI goes in `src/components/`, reusable logic in `src/lib/`, and hooks in `src/hooks/`. Root-level `.sql`, `.js`, and `.ts` files such as `upgrade_v4_rbac.sql` or `migrate-purchase-orders.ts` are migration or repair utilities and should be treated as production-affecting.

## Build, Test, and Development Commands

Use `npm run dev` for local development, `npm run build` to validate production output, `npm run start` to run the built app, and `npm run lint` for ESLint checks. There is no dedicated test script yet, so lint, build, and targeted manual checks are the minimum verification set.

## Coding Style & Naming Conventions

Prefer TypeScript-first changes and follow the existing style: 2-space indentation, double quotes, semicolons, and `@/*` imports from `src/`. Use `PascalCase` for components, `camelCase` for functions and variables, and lowercase route folders such as `src/app/vendor/shipments/`. Keep business rules in `src/lib/` or API routes instead of large page components.

## Testing & Verification

No formal test framework is configured yet. Run `npm run lint` and `npm run build`, then manually exercise the affected flow. High-risk areas are login, permissions, inventory totals, receive, dispense, vendor shipments, purchase orders, and LINE webhook behavior. If tests are added later, name them by behavior, for example `inventory-reconcile.test.ts`.

## Commit & Pull Request Guidelines

Recent history uses short subject lines such as `Fix: ...`, `Update: ...`, and feature summaries. Prefer concise, scoped commits like `Fix: validate auth token in dispense API`. Pull requests should state user impact, affected routes or APIs, environment or migration notes, verification performed, and screenshots for visible UI changes.

## Security & Configuration Tips

Keep secrets only in `.env.local`. Do not commit Neon credentials, LINE channel secrets, mail settings, or manual SQL results containing sensitive data. Any change touching auth, webhook validation, RBAC, or database migration scripts should be reviewed as a production-risk change and verified on the exact affected flow before merge.
