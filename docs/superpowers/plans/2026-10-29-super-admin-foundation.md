# Super admin foundation (PR 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a database-backed "Super admin" permission (`users.is_super_admin`) and a server-side guard `requireSuperAdmin`, with no change to any existing Admin behavior.

**Architecture:** Plan B from the spec: `5783` stays `role = 'Admin'`; a new boolean column marks Super admin. The flag is read from the database on every guarded call (never from the session/token). Code deploys safely BEFORE the migration (missing column => "not super admin", never a 500). PR 2 (room management UI) and PR 3 (room admins / members) build on this guard.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before writing route code — AGENTS.md), TypeScript, postgres via `@/lib/db`, Vitest + PGlite (`@/test/department-fixtures`).

**Spec:** `docs/superpowers/specs/2026-10-29-super-admin-rooms-design.md`

## Global Constraints

- Super admin = `users.role = 'Admin'` AND `users.is_super_admin = true` AND `users.account_status = 'active'`, checked in SQL each call.
- No existing `role === "Admin"` check is modified in this PR.
- Migration is additive + idempotent, numbered **v37** (v36 exists), has a rollback file, and is NOT run automatically (apply with `node scripts/apply-migration.mjs <file> --confirm-host=<non-pooler host>`; the user runs it).
- The migration file sets no data. Granting `5783` is a separate file the user runs after review.
- Secrets never in code; `ψ/` is never committed; never touch `/generated/`.
- Style: TypeScript, 2 spaces, double quotes, semicolons, `@/*` imports, business logic in `src/lib/`.
- Production DB writes need the owner's approval at each step; rehearse on a separate Neon branch, never on `production`.

## Review Focus

- `5783` is `suspended` or `pending` with the flag still true -> denied.
- Flag true but role later changed to `Manager`/`Vendor` -> denied (role check is in the same SQL).
- Plain `Admin` without the flag -> 403 (the main promise: Admin does not gain access).
- Column `is_super_admin` does not exist yet (code deployed before migration) -> `false`, no throw.
- Username with stray case/whitespace (`" 5783"`, `"5783 "`) -> not matched (exact match only).
- Unauthenticated -> 401; cross-origin write -> 403.

---

### Task 1: Migration v37 (+ rollback, + grant file)

**Files:**
- Create: `upgrade_v37_super_admin.sql`, `upgrade_v37_super_admin_rollback.sql`, `upgrade_v37_super_admin_grant.sql`
- Test: `src/lib/super-admin-migration.db.test.ts`

**Interfaces:**
- Produces: column `users.is_super_admin boolean NOT NULL DEFAULT false`.

- [ ] **Step 1: Write the failing test** using the room-admin.db.test.ts pattern (PGlite + `seedTwoDepartments`, then `applyMigrationFile(db, "upgrade_v37_super_admin.sql")`). Tests: `adds is_super_admin defaulting to false for every existing user` (select count where flag true = 0, `admin1` flag false); `is idempotent` (apply twice, no error); `grant file sets only the named Admin` (apply `upgrade_v37_super_admin_grant.sql` after inserting an Admin `5783` and a User `5783x`; only `5783` is true); `grant file does not promote a non-Admin named 5783` (role `User` -> stays false); `rollback drops the column` (apply rollback; column absent).
- [ ] **Step 2: Run** `npx vitest run src/lib/super-admin-migration.db.test.ts` — expect FAIL (files missing).
- [ ] **Step 3: Write the three SQL files** in the style of `upgrade_v35_room_admin_slot.sql` (header comment, `SET lock_timeout = '3s';`). Migration: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;`. Grant: `UPDATE users SET is_super_admin = true WHERE username = '5783' AND role = 'Admin' AND account_status = 'active';`. Rollback: `ALTER TABLE IF EXISTS users DROP COLUMN IF EXISTS is_super_admin;` with a warning to export who has the flag first.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `Add: migration v37 users.is_super_admin (+ rollback, grant)`.

### Task 2: `isSuperAdmin` and `requireSuperAdmin`

**Files:**
- Create: `src/lib/super-admin.ts`
- Test: `src/lib/super-admin.db.test.ts` (PGlite + v37 applied, same mock-`./db` pattern as `src/lib/room-admin.db.test.ts`)

**Interfaces:**
- Consumes: `getAuthenticatedUser(request): Promise<AuthenticatedUser | null>` (`@/lib/auth-utils`), `isCrossOrigin(request): boolean` (`@/lib/room-route`), `apiError(code, { requestId })` (`@/lib/api-response`), `TrackContext` (`@/lib/app-events`), `sql` (`@/lib/db`).
- Produces:
  - `isSuperAdmin(username: string): Promise<boolean>`
  - `requireSuperAdmin(request: Request, ctx: TrackContext, options: { write: boolean }): Promise<AuthenticatedUser | Response>` — returns the user, or the error Response (401 `AUTH_REQUIRED`, 403 `FORBIDDEN`).

- [ ] **Step 1: Write the failing tests** (names exact, one per Review Focus line plus the happy path): `true for an active Admin with the flag`; `false for an Admin without the flag`; `false when suspended`; `false when pending`; `false when role is Manager even with the flag`; `false when role is Vendor even with the flag`; `false for unknown or padded usernames`; `false (does not throw) when the is_super_admin column is missing` (use a PGlite without v37); `requireSuperAdmin returns 401 when signed out` (mock `getAuthenticatedUser` -> null); `returns 403 for a plain Admin`; `returns 403 for a cross-origin write even for the Super admin`; `returns the user for the Super admin`.
- [ ] **Step 2: Run** `npx vitest run src/lib/super-admin.db.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `isSuperAdmin`** with one query: `SELECT 1 FROM users WHERE username = ${username} AND role = 'Admin' AND is_super_admin = true AND account_status = 'active' LIMIT 1`. Catch Postgres error code `42703` (undefined column; see how `isMissingDepartmentSchemaError` in `src/lib/departments-flag.ts` detects schema errors) and return `false`; rethrow anything else. **Implement `requireSuperAdmin`:** order = cross-origin (if `options.write`) -> `getAuthenticatedUser` -> `isSuperAdmin(user.username)`; set `ctx.user = user` as `authorizeRoomRoute` does (`src/lib/room-route.ts`).
- [ ] **Step 4: Run** the tests — expect PASS.
- [ ] **Step 5: Commit** `Add: isSuperAdmin and requireSuperAdmin guard`.

### Task 3: `GET /api/super-admin/status`

**Files:**
- Create: `src/app/api/super-admin/status/route.ts`
- Test: `src/app/api/super-admin/status/route.test.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin` (Task 2), `trackRoute` (`@/lib/app-events`; copy the no-params usage from an existing route such as `src/app/api/session/department/route.ts`, action name `super_admin.status`).
- Produces: `GET` -> `200 { superAdmin: true }` for the Super admin; otherwise the guard's 401/403. PR 2's UI uses it to decide whether to show the menu.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/super-admin`): `200 {superAdmin:true} for the Super admin`; `401 when signed out`; `403 for a plain Admin`; `response never includes password_hash or any user fields` (body keys exactly `["superAdmin"]`).
- [ ] **Step 2: Run** `npx vitest run src/app/api/super-admin/status/route.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the route wrapping `requireSuperAdmin(request, ctx, { write: false })`.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `Add: GET /api/super-admin/status`.

### Task 4: Rollout notes and full verification

**Files:**
- Modify: `docs/departments-rollout.md` (append a "Super admin (v37)" section), and add a dated entry to `AI_WORKSPACE/PROJECTS/lab-stock-nextjs/decisions.md`.

- [ ] **Step 1: Document the order:** deploy code -> rehearse v37 + grant on a Neon branch -> owner approves -> owner runs v37 on production -> owner runs grant -> verify with a read-only `SELECT username, role, is_super_admin FROM users WHERE is_super_admin` (expect only `5783`) -> sign in as `5783` and call `/api/super-admin/status` (expect 200) and as another Admin (expect 403). Include the rollback command.
- [ ] **Step 2: Run the full checks:** `npx vitest run`, `npx tsc --noEmit -p .`, `npm run lint`, `npm run build`. Expected: all pass; report anything that cannot run.
- [ ] **Step 3: Commit** `Update: rollout notes for super admin v37`. Open the PR (description: user-facing effect = none yet; new API `/api/super-admin/status`; migration v37 + grant not yet run; checks run).
