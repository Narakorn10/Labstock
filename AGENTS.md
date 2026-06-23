# Repository Guidelines

<!-- BEGIN:nextjs-agent-rules -->
This repository uses a Next.js build that may differ from common examples. Before changing framework-specific behavior, check the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

## Project Structure & Module Organization

Application routes live in `src/app/` using the App Router. Keep feature pages grouped by workflow such as `src/app/dispense/`, `src/app/receive/`, `src/app/master/`, and `src/app/vendor/`. API handlers belong in `src/app/api/`. Shared UI goes in `src/components/`, reusable logic in `src/lib/`, custom hooks in `src/hooks/`, and static assets in `public/`. Root-level `.sql`, `.js`, and `.ts` migration scripts are operational utilities; treat them as production-affecting changes.

## Build, Test, and Development Commands

Use `npm run dev` for local development, `npm run build` to validate production build output, `npm run start` to run the built app, and `npm run lint` for ESLint checks. There is no dedicated test script in `package.json` yet, so treat lint and build as the minimum verification set before delivery.

## Coding Style & Naming Conventions

Use TypeScript-first changes and preserve the existing style: 2-space indentation, double quotes, semicolons, and `@/*` imports from `src/`. Use `PascalCase` for components, `camelCase` for functions and variables, and lowercase route folders such as `src/app/vendor/shipments/`. Keep server utilities in `src/lib/` and avoid moving business rules into page components when a helper module is clearer.

## Testing & Verification

No formal test framework is configured yet. Verify changes by running `npm run lint` and `npm run build`, then manually exercise the affected flow, especially login, permissions, inventory, receive, dispense, vendor shipments, and LINE webhook behavior. When adding tests later, place them near the feature or under a dedicated test folder and name them by behavior, for example `inventory-reconcile.test.ts`.

## Commit & Pull Request Guidelines

Recent history uses short subject lines such as `Fix: ...`, `Update: ...`, `Debug: ...`, and feature summaries. Prefer concise, scoped commits like `Fix: validate auth token in dispense API`. Pull requests should state user impact, affected routes or APIs, environment or migration notes, verification performed, and screenshots for visible UI changes.
