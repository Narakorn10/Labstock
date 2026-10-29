# Vendor Sign-up in the Company's Own Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vendor can sign up for a company approved in any usable room; the account is created in that company's room; `auth/register` leaves `DEPARTMENT_SCOPE_PENDING` (list becomes empty).

**Architecture:** One helper `src/lib/vendor-registry.ts` owns the "approved companies across all rooms" reads (explicit `{ mode: "all" }` through `scoped-db`, deliberate and commented). `auth/register` GET and POST call it and place a Vendor account in the room returned for the matched company. `account-status` is NOT changed. With the department switch off (or schema missing) the helper runs the exact legacy SQL with no department columns.

**Tech Stack:** Next.js route handlers (read `node_modules/next/dist/docs/` before Next-specific changes), TypeScript, vitest, PGlite via `src/test/department-fixtures.ts`.

**Spec:** `docs/superpowers/specs/2026-10-29-vendor-register-company-wide-design.md`

## Global Constraints

- Sign-up keeps a pick-from-list control; a company appears once in the list; `users.vendor` must equal the exact stored `vendors.name`.
- Vendor with an existing company: account + membership in the matched row's room (switch on). Request-mode Vendor and lab accounts: unchanged (request-mode -> default room CC, 503 when CC is missing).
- A "usable room" = `departments.is_active` AND `departments.code IS NOT NULL` (same as `src/lib/user-rooms.ts` `listSelectableRooms`). Companies of unusable rooms are not listed and not accepted.
- Switch off or schema missing: the helper's SQL must not mention `department_id`, `departments` or `user_departments`. Keep the legacy statements equivalent to today's: `SELECT name FROM vendors WHERE is_approved = TRUE ORDER BY name ASC` and `SELECT name FROM vendors WHERE LOWER(name) = LOWER(${vendorName}) AND is_approved = TRUE LIMIT 1` (`route.ts:73-78,147-153`). The guard is the regex plus statement count (`> 12`, 16 per DB) in the "flag OFF: recorded SQL" test of `route.test.ts` (~lines 109-129); the register test file has no `includes("FROM vendors")` mock.
- Vendor-with-existing-company when the switch is on in the route but `findApprovedVendor` returned `departmentId === null` (the flag cache flipped between the helper's and the route's `departmentsReady()` calls): answer 503 with the retry message `'ไม่สามารถลงทะเบียนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'`, create nothing, and NEVER fall back to `defaultRoomId()`.
- No comment in the register file may contain the text `FROM|JOIN|INTO|UPDATE vendors` (the coverage scanner reads raw text).
- Response shapes unchanged: `GET /api/auth/register` -> `{ vendors: string[], departments, registrationMode }`.
- The register file must not contain the text `FROM vendors` / `JOIN vendors` etc. after the change (the coverage test scans raw text, comments included). Do not add `vendors` to `account-status` either (that file keeps its own query and its `andDept` import untouched).
- `vendors_name_key` (`UNIQUE (name)`) stays; do not write or run any migration. Do not change `account-status`, `members`, Vendor routes, or `loadPrintDetails`.
- Style: TypeScript, 2-space indent, semicolons, `@/*` imports; keep each existing file's own quote style. No new env var. Do not commit `ψ/`. Commit messages `Update: ...`/`Fix: ...` ending with the session's attribution lines.

## Review Focus

- Switch off / database without v30: sign-up runs no department SQL and behaves as today (recorded-SQL test). Pinned in Task 1 and Task 2.
- A company only in room B: listed, accepted, stored with its exact name, account + membership in room B (not CC). Pinned in Task 2.
- A company in CC and in another room (only possible once `vendors_name_key` is dropped, so it is pinned in Task 1 only, with its own database): ordering prefers the room whose code is 'CC' even when it is not the lowest id.
- A company only in an inactive room or a room without a code: not listed, rejected with 400. Pinned in Task 1 and Task 2.
- Spellings differing only by case in two rooms: both listed; the spelling the visitor picked wins; a case-only input falls back to CC, then the lowest room id. Pinned in Task 1.
- Duplicate username/email: still 409 and no membership written. Existing test in `route.test.ts`, must keep passing.

---

### Task 1: `vendor-registry` helper

**Files:**
- Create: `src/lib/vendor-registry.ts`
- Test: `src/lib/vendor-registry.db.test.ts` (PGlite with `seedTwoDepartments`; mock `@/lib/db` like `src/app/api/auth/register/route.test.ts:12-17`, which provides `unsafe` and `transaction`. The mock in `department-options.db.test.ts` lacks `unsafe`, and `andDept` calls `sql.unsafe` even in mode "all", so do not copy that one)
- Test: `src/lib/vendor-registry.test.ts` (unit, mocks `@/lib/db` and `@/lib/departments-flag` like `src/lib/mobile-lookup-auth.test.ts:5-18,141-146`)

**Interfaces:**
- Consumes: `departmentsReady`, `markDepartmentsNotReady`, `isMissingDepartmentSchemaError` (`@/lib/departments-flag`); `andDept` (`@/lib/scoped-db`); `sql` (`@/lib/db`).
- Produces:
  ```ts
  export async function listApprovedVendorNames(): Promise<string[]>;
  export async function findApprovedVendor(name: string): Promise<{ name: string; departmentId: number | null } | null>;
  ```

Behaviour: `departmentsReady()` false -> legacy SQL (text-identical, see Global Constraints); `findApprovedVendor` returns `{ name, departmentId: null }`. Ready -> `FROM vendors v JOIN departments d ON d.id = v.department_id WHERE v.is_approved = TRUE AND d.is_active AND d.code IS NOT NULL` plus `andDept({ mode: "all" }, "v")` (an empty fragment, kept as a commented, visible marker of the deliberate all-rooms read). `listApprovedVendorNames`: `SELECT DISTINCT v.name ... ORDER BY v.name ASC`. `findApprovedVendor(name)`: `LOWER(v.name) = LOWER(${name})`, `ORDER BY (v.name = ${name}) DESC, (d.code = 'CC') DESC, v.department_id ASC, v.id ASC LIMIT 1`, return `{ name: v.name, departmentId: Number(v.department_id) }`. A missing-schema error (`isMissingDepartmentSchemaError`) -> `markDepartmentsNotReady("vendor registry ...")` and fall back to the legacy query.

- [ ] **Step 1: Write failing tests.**
  - DB file (own in-memory DB, so this file may `DROP CONSTRAINT vendors_name_key` to hold the same name in two rooms; set `process.env.DEPARTMENTS_ENABLED = "true"` and call `resetDepartmentsFlagForTests()` in `beforeEach`, as `route.test.ts:51-54` does; unsetting in `afterAll`): `"flag on: a vendor only in room B is listed"`; `"a vendor in an inactive room is not listed and not found"`; `"a vendor in a room without a code is not listed and not found"`; `"is_approved = false is never listed or found"`; `"the same exact name in two rooms is listed once"`; `"names differing only by case in two rooms are both listed"`; `"findApprovedVendor: the exact spelling picked wins over a lower room id"`; `"findApprovedVendor returns the matched row's department id"`; `"findApprovedVendor prefers the room coded CC even when it is not the lowest id"` (fixtures make CC id 1, so in the test first set room 1's code to 'Z1' and room 2's code to 'CC' (codes are unique), seed case-only spellings in rooms 1 and 2, expect room 2); `"findApprovedVendor without any CC room falls back to the lowest room id"` (rooms 2 and 3, no 'CC'); `"two spellings in the same room that differ only by case tie-break by v.id"`.
  - Unit file (its `@/lib/db` mock must provide `unsafe` and nested `sql` fragments, because `andDept` calls `sql.unsafe` even in mode "all"): `"flag off: legacy statements run and none mentions department_id, departments or user_departments"` (record the statements); `"flag off: findApprovedVendor returns departmentId null"`; `"schema error on the join marks departments not ready and falls back to the legacy query"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/vendor-registry`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the two functions as described.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** helper and tests: `Update: add vendor-registry helper (approved companies across usable rooms)`.

---

### Task 2: `auth/register` uses the helper, leaves PENDING, docs and decision record

**Files:**
- Modify: `src/app/api/auth/register/route.ts:64-92` (GET), `:134-168` (existing-company check), `:170-215` (room choice and insert); remove the two "Deliberate (owner decision)" comments and every direct `vendors` query; rewrite the comment at `:170` ("a vendor account goes to the default room (CC)") to describe the new rule; the 503 case for `departmentId === null` is added here
- Modify: `src/lib/department-scope-coverage.test.ts:30-32` (delete the `auth/register` entry; `DEPARTMENT_SCOPE_PENDING` becomes `[]`, still exported with its comment)
- Modify: `src/app/api/auth/register/route.test.ts` (describe "vendors of ALL departments (deliberate, owner decision)" at ~80-107: rename/update; the test "flag ON: that vendor account lands in the default room (CC), not in the vendor's room B" must now expect room B)
- Modify: `docs/departments-rollout.md` (replace the caveat block at ~201-205; strike through or annotate, as the file already does at ~line 136, the two statements that become false: ~line 142 "ปัจจุบันเหลือ 1 รายการ คือ auth/register" and ~line 555 "ตอนนี้เหลือแค่ auth/register" -- and say that the rule "no second-room data until `DEPARTMENT_SCOPE_PENDING` is empty" is now met by the code, but the switch stays off until the Neon/v30-v36 preparation steps are approved; append a final Thai section in the file's style: removed `auth/register` from `DEPARTMENT_SCOPE_PENDING` (**1 -> 0**, counted from `department-scope-coverage.test.ts`), what changed for the user, Known limits from the spec, "tested only with PGlite, not on a real database", no migration, no new env var)
- Modify (outside the repo, last): `C:\Users\HP Probook 440 G9\AI_WORKSPACE\PROJECTS\lab-stock-nextjs\decisions.md` (append: owner decided 2026-10-29 one account per company placed in the company's room; `vendors_name_key` kept; `DEPARTMENT_SCOPE_PENDING` empty; Known limits including that Admin-created Vendor users skip the company check)

**Interfaces:**
- Consumes: Task 1's `listApprovedVendorNames`, `findApprovedVendor`. Produces: nothing for other tasks.

POST behaviour (existing company): `const match = await findApprovedVendor(vendorName)`; null -> the existing 400 `'ไม่พบบริษัทที่ได้รับอนุมัติ โปรดเลือกใหม่หรือส่งคำขอเพิ่มบริษัท'`; else `vendor = match.name`. Room: lab -> `parseRoomId(body.departmentId)` as today; Vendor with `match` -> `roomId = match.departmentId` (switch on; it is a usable room by construction); request-mode Vendor -> `defaultRoomId()` as today. The existing single-statement insert (room CTE with `is_active AND code IS NOT NULL`) stays, so a room that became unusable in between creates nothing and answers the existing 400.

- [ ] **Step 1: Write/adjust failing tests** in `route.test.ts` (existing style: PGlite `migrated` DB through the `@/lib/db` mock; do NOT mock the helper, so the recorded-SQL test keeps seeing its statements; do NOT drop `vendors_name_key` in this shared DB):
  - `"flag on: a vendor only in room B signs up; the account and its membership are in room B and users.vendor is the exact stored name"` (replaces the old "lands in CC" test at ~lines 102-106). Assert the whole membership row, as the lab test does at ~line 144: `[{ department_id: DEPT_B, role: null, is_default: true }]`.
  - `"flag on: a vendor that exists in CC signs up into CC"` (use a seeded CC vendor).
  - `"flag on: existing-company vendor whose match has no department id gets 503 and nothing is created"` (mock/spy so that the helper returns `departmentId: null` while the route sees departments ready; if that is awkward in this file, cover it with a small separate unit test on the route's decision and say so in the report).
  - `"flag on: a vendor only in an inactive room cannot sign up (400) and nothing is created"` (new, must FAIL before the change).
  - `"flag on: request-mode vendor goes to the default room CC"` (unchanged behaviour, keep/rename).
  - keep `"flag OFF: GET and POST never mention department_id, user_departments or departments"` and the 409 test.
  - the "GET lists a vendor that exists only in department B" and "POST accepts a vendor that exists only in department B" tests stay (both flags) as regressions.
- [ ] **Step 2: Run** `npx vitest run src/app/api/auth/register src/lib/department-scope-coverage.test.ts`. Expected: the new/changed tests FAIL (the inactive-room one is the only brand-new behaviour; the room-B placement one fails on the old CC expectation).
- [ ] **Step 3: Implement** the route changes and shrink `DEPARTMENT_SCOPE_PENDING` to `[]`. The coverage test requires the entry to go because the route will no longer touch a department table (no `FROM vendors` text left, comments included), which makes the entry stale.
- [ ] **Step 4: Run** `npx vitest run src/app/api/auth/register src/lib/vendor-registry src/lib/department-scope-coverage.test.ts`. Expected: PASS.
- [ ] **Step 5: Docs + decision record** as listed.
- [ ] **Step 6: Verify** `npx tsc --noEmit -p .`, `npm run lint` (one pre-existing warning at `src/app/settings/barcodes/page.tsx:484` is expected), and the full `npx vitest run`. Do NOT run `npm run build` or any dev server (the controller does that). State plainly that the manual sign-up flow was not tried on a real database.
- [ ] **Step 7: Commit**: `Update: vendor sign-up places the account in the company's room`.

---

## Self-review notes
- Spec coverage: helper and ordering rules (Task 1), register GET/POST placement and PENDING removal (Task 2), docs/decision/Known limits (Task 2); `account-status` intentionally untouched (spec Non-goals).
- Types: `findApprovedVendor` -> `{ name, departmentId }` used identically in Task 1 tests and Task 2 route.
- Proportion: plan is shorter than the first draft; helper body and route edits are left to the implementer beyond the signatures and exact SQL ordering above.
