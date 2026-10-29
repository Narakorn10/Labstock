# Mobile Lookup Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/mobile/lookup` requires a signed-in caller and returns only the items and lots of the department that `/api/mobile/confirm` will act in.

**Architecture:** A helper `authenticateMobileLookup(request)` in `src/lib/mobile-lookup-auth.ts` works in two steps, like `confirm`: (1) prove identity (LINE ID token in header `X-Line-Id-Token` if the header is present, otherwise the Auth.js session via `getAuthenticatedUser`); (2) pick the department with `resolveDepartmentForVerifiedUser`, the same function `confirm` uses, so both always agree. The route then filters `master_data` and `inventory` with `scoped-db`. The three client screens handle 401 (web) or send the token (LIFF).

**Tech Stack:** Next.js route handlers (read `node_modules/next/dist/docs/` before touching Next-specific behaviour), TypeScript, vitest, PGlite via `src/test/department-fixtures.ts`.

**Spec:** `docs/superpowers/specs/2026-10-29-mobile-lookup-auth-design.md` (this plan deliberately deviates from it in the places listed under "Deviations from the spec"; the spec is updated to match).

## Global Constraints

- Department is never read from the request (no header, query, body) and "all departments" (`scope === "ALL"`) is never possible on this route.
- Identity is checked **before** anything about department readiness; no path may return data to an anonymous caller.
- Code style: TypeScript, 2-space indent, double quotes, semicolons, `@/*` imports; no secrets in code; do not edit `/generated/`.
- No migration, no new env var. Do not commit `ψ/`. Commit messages short (`Fix: ...`, `Update: ...`) and end with the attribution line required by the session.
- Vendor (global role or role in that department) gets 403 `"This role cannot approve mobile stock transactions."` (same text as `confirm`). No usable department gets 403 `"บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ"` (same text as `confirm`).
- Anything that is not a handled failure returns a fixed message with status 500; raw exception text (which can contain usernames or SQL) is never put in a response body.
- Response shape of `lookup` on success is unchanged: `{ reagents, patterns, v2Patterns, engineVersion }`, now with header `Cache-Control: no-store`.

## Deviations from the spec (owner to confirm)
1. Identity order: if header `x-line-id-token` is present, **only** the LINE identity is used (a stale web cookie of someone else must never win; LIFF opens in an external browser). Without the header, the session is used. (Spec listed session first.)
2. Department: both paths call `resolveDepartmentForVerifiedUser` after identity is proven (spec used `resolveUserDepartment` for sessions). Reason: it is literally the function `confirm` uses, and it avoids reading the session twice and a flag-cache race.
3. Session that is expired / revoked / has no usable department gets **401** (go to login). Only the LINE path, whose identity and active status were verified, gets 403 for "no department".
4. The guard test `ALLOWED` gets the helper file (the caller), not the route.
5. After sign-in the login page always lands on `/dashboard` (`src/app/login/page.tsx:64`); a "way back" to the mobile page is not added in this change.
6. `lookup` is **not** one of the last two pending routes (46 entries today, 45 after this). The rule "no data in a second department until `DEPARTMENT_SCOPE_PENDING` is empty" still stands; the spec text saying it was one of the last two was wrong.

## Known limits to write in the docs (not fixed here)
- On web `/mobile`, the person who confirms is the username+PIN typed at confirm time, which can differ from the person signed in. If they have different default departments, confirm is refused (`ITEM_NOT_IN_DEPARTMENT`, safe, no leak) but may confuse the user. `confirm` is not changed (spec non-goal).
- Barcode patterns (`loadRuntimeBarcodePatterns`) stay unscoped; `src/lib/barcode-runtime.ts` stays in `DEPARTMENT_SCOPE_PENDING`.
- A LINE ID token expires; reloading lookup late in a LIFF session can return 401 ("open the LIFF page again"). Same as `confirm` today.
- Every LIFF lookup calls LINE's token-verify API. Open LIFF pages running old JS get 401 until reloaded after deploy.

## Review Focus

- Session user who is a member of two departments, non-default one active in the Auth.js token: `lookup` shows the **default** department. Pinned in Task 1 (DB test).
- Global Admin with no membership row, and Admin with `activeDepartmentId: "ALL"` in the token: resolves to one numeric department, never `ALL`. Pinned in Task 1 (DB test) and Task 2 (route refuses `scope: "ALL"`).
- `DEPARTMENTS_ENABLED` off, or schema missing: anonymous still gets 401; signed-in caller gets the old unfiltered data. Pinned in Task 1 and Task 2.
- LINE header present together with a session cookie of another user: the LINE identity wins. Invalid/expired LINE token or unlinked account: 401, never a fallback to the cookie. Pinned in Task 1.
- Revoked / expired session: 401, not the "contact admin" 403. Error bodies never contain usernames or SQL text. Pinned in Task 1 and Task 2.

---

### Task 1: `authenticateMobileLookup` helper

**Files:**
- Create: `src/lib/mobile-lookup-auth.ts`
- Test: `src/lib/mobile-lookup-auth.test.ts` (mocked dependencies, style of `src/app/api/liff/orders/bootstrap/route.test.ts`)
- Test: `src/lib/mobile-lookup-auth.db.test.ts` (PGlite: `seedTwoDepartments`, mock `@/auth` and `@/lib/db` like `src/lib/department-context.db.test.ts:20-28,47`)
- Modify: `src/lib/department-context.verified-usage.test.ts:11` (add `"src/lib/mobile-lookup-auth.ts"` to `ALLOWED`, keep sorted) and the comments at its lines 5-6 and `src/lib/department-context.ts:113` ("Only /api/mobile/confirm may use this") so they name both callers

**Interfaces:**
- Consumes: `resolveDepartmentForVerifiedUser` (`@/lib/department-context`); `departmentsReady`, `markDepartmentsNotReady`, `isMissingDepartmentSchemaError` (`@/lib/departments-flag`); `verifyLineIdToken`, `getLineLinkedUser`, `hasUserLineIdColumn` (`@/lib/line-liff-auth`); `getAuthenticatedUser`, `type AuthenticatedUser` (`@/lib/auth-utils`).
- Produces:
  ```ts
  export const LINE_ID_TOKEN_HEADER = "x-line-id-token";
  export type MobileLookupAuth =
    | { ok: true; user: AuthenticatedUser }
    | { ok: false; response: NextResponse };
  export async function authenticateMobileLookup(request: Request): Promise<MobileLookupAuth>;
  ```

Behaviour, in this order:
1. **Identity.**
   - Header present: `verifyLineIdToken` (null -> 401 `"LINE authentication failed."`); `hasUserLineIdColumn()` false -> 400 as `confirm` does (`confirm/route.ts:46-48`); `getLineLinkedUser(identity.sub)` null -> 401. The session is **not** consulted.
   - Header absent: `getAuthenticatedUser(request)`; null -> 401 `"Please sign in."`.
   - No department or flag code has run yet when a 401 is returned.
2. **Vendor** global role -> 403 (same text as `confirm`).
3. **Department.** If `await departmentsReady()`: `resolveDepartmentForVerifiedUser(user)` inside its own `try/catch` (only this call): `null` -> 403 no-department for LINE, **401** for session; `isMissingDepartmentSchemaError` -> `markDepartmentsNotReady("mobile lookup department resolution failed; using legacy path")` and continue as not ready; other errors -> 500 fixed message. Then re-check Vendor (`user.role === "Vendor"` or `globalRole === "Vendor"`) -> 403.
   Not ready (or fell back): return only `{ username, name, role, vendor }` of the verified user, dropping `scope`, `departmentId`, `activeDepartment` and any similar fields, so a later `getDepartmentScope` cannot see a stale "ALL".
4. Any unexpected throw in step 1 -> 500 fixed message `"Unable to verify your account."`.

- [ ] **Step 1: Write failing unit tests** in `mobile-lookup-auth.test.ts` (names and assertions):
  - `"no header and no session gives 401 without touching department code"`: `departmentsReady` and the resolver not called.
  - `"session user is resolved with resolveDepartmentForVerifiedUser and its result is returned"`.
  - `"session whose resolver returns null gives 401"`; `"LINE user whose resolver returns null gives 403 with the no-department message"`.
  - `"LINE header wins over a session of another user"`: `getAuthenticatedUser` not called, resolver called with the LINE user.
  - `"invalid LINE token gives 401 and does not fall back to the session"`; `"unlinked LINE account gives 401"`.
  - `"vendor gives 403"` and `"vendor role inside the department gives 403"` (global User, resolved role Vendor).
  - `"flag off: no resolver call and scope fields are dropped from the returned user"`.
  - `"schema error from the resolver marks departments not ready and returns the unscoped user"`; `"schema error thrown by getLineLinkedUser does NOT call markDepartmentsNotReady"`.
  - `"unexpected resolver error gives 500 with a fixed body that contains no username"`.
- [ ] **Step 2: Write failing DB tests** in `mobile-lookup-auth.db.test.ts` using `seedTwoDepartments` and a mocked `@/auth` session (`sessionAs` style, `DEPARTMENTS_ENABLED=true`):
  - `"user1 with activeDepartmentId = DEPT_B still resolves scope DEPT_A"` (dept 1 is default).
  - `"admin1 with no membership rows resolves scope 1, not ALL"` (delete its `user_departments` rows in the test).
  - `"admin1 with activeDepartmentId 'ALL' resolves a numeric scope"`.
  - `"newbie (no membership) is refused"`.
  - `"scope equals resolveDepartmentForVerifiedUser for solo1, solo2, user1, admin1"`.
- [ ] **Step 3: Run** `npx vitest run src/lib/mobile-lookup-auth.test.ts src/lib/mobile-lookup-auth.db.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** the helper and exports above. Copy the Thai/English messages verbatim from `src/app/api/mobile/confirm/route.ts:72-92`. Return failures with `NextResponse.json({ error }, { status })`.
- [ ] **Step 5: Update** `ALLOWED` and the two comments named above.
- [ ] **Step 6: Run** the two new test files plus `src/lib/department-context.verified-usage.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** helper, tests, comment edits: `Update: add sign-in helper for mobile lookup`.

---

### Task 2: Scope the `lookup` route

**Files:**
- Modify: `src/app/api/mobile/lookup/route.ts:5-58,114-118` (auth first, scoped queries, safe errors)
- Modify: `src/lib/department-scope-coverage.test.ts:41` (delete the `"src/app/api/mobile/lookup/route.ts"` entry from `DEPARTMENT_SCOPE_PENDING`; list goes 46 -> 45)
- Test: `src/app/api/mobile/lookup/route.dept.db.test.ts` (PGlite; model on `src/app/api/reagent-loans/route.dept.db.test.ts`; mock `@/lib/mobile-lookup-auth` so the test controls the user)

**Interfaces:**
- Consumes: `authenticateMobileLookup`; `getDepartmentScope`, `andDept` (`@/lib/scoped-db`); `isDepartmentScopeFailure`, `toApiError` (`@/lib/api-response`); `getRequestId` (`@/lib/request-observability`), error pattern of `src/app/api/reagent-loans/route.ts:63-64`.
- Produces: `GET(request: Request): Promise<Response>`.

- [ ] **Step 1: Write failing DB tests** (`beforeEach`: `DELETE FROM inventory`, then insert own lots with explicit `department_id`, as `reagent-loans/route.dept.db.test.ts:39-52` does; the seed already contains `LAB-…` lots; use `A-000002` for department A and `MB-000001` for B):
  - `"auth failure response is returned untouched and no query runs"` (401).
  - `"department B user sees only B items and B lots"` and `"department A user sees only A items"`.
  - `"every returned lot belongs to the caller's department"` (direct query on `inventory`).
  - `"an A-owned lot attached to a B item is not shown to B"` (v32 has no cross-table check, so insert it directly with `department_id = DEPT_A`).
  - `"flag off, user without scope: all items are returned"`.
  - `"a user with scope ALL gets 500 and no data"` (helper mocked to return `scope: "ALL"`).
  - `"500 body contains no username or SQL text"` (make a query throw; assert body equals the fixed message).
  - `"response keeps reagents, patterns, v2Patterns, engineVersion and has Cache-Control no-store"`.
- [ ] **Step 2: Run** `npx vitest run src/app/api/mobile/lookup`. Expected: FAIL.
- [ ] **Step 3: Implement.** `export async function GET(request: Request)`; `requestId = getRequestId(request)`; first thing in `try`: `const auth = await authenticateMobileLookup(request); if (!auth.ok) return auth.response;`. Then `const scope = await getDepartmentScope(auth.user); if (scope.mode === "all") throw` a fixed internal error (500). Add `${andDept(scope, "m")}` and `${andDept(scope, "i")}` to the two queries (aliases `master_data m`, `inventory i`; selected column names unchanged). Leave `loadRuntimeBarcodePatterns()` alone. In `catch`: `isDepartmentScopeFailure(error)` -> `toApiError(error, requestId).response`; otherwise `console.error` and return `{ error: "Unable to load stock data." }` with status 500. Set `Cache-Control: no-store` on the success response.
- [ ] **Step 4: Remove** the route from `DEPARTMENT_SCOPE_PENDING` (the coverage test fails if a listed file imports `scoped-db`).
- [ ] **Step 5: Run** `npx vitest run src/app/api/mobile/lookup src/lib/department-scope-coverage.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** route, coverage test, new test: `Update: require sign-in and scope mobile lookup by department`.

---

### Task 3: Client callers and docs

**Files:**
- Modify: `src/components/mobile/mobile-home.tsx:20`, `src/components/mobile-stock-workflow.tsx:89`
- Modify: `src/components/liff-dispense-workflow.tsx:146-173`
- Modify: `docs/departments-rollout.md:96` (+ the pending counts it mentions), `docs/superpowers/specs/2026-10-29-mobile-lookup-auth-design.md` (apply the "Deviations" list)

**Interfaces:** Consumes Task 2's 401 behaviour. Produces nothing for other tasks.

- [ ] **Step 1:** In both web screens, when `response.status === 401`, call `window.location.assign("/login")` (neither file uses a router today). Other failures keep the current error display.
- [ ] **Step 2:** In `liff-dispense-workflow.tsx`, `loadLookupData` is a `useCallback(..., [])` and `idToken` starts as `""`: add `idToken` to its dependency list, send `headers: { "X-Line-Id-Token": idToken }`, and make the effect at lines 169-173 run only when `user && idToken`. Reloads (lines ~404, 516, 545) then use the current token. A 401 shows the existing error text.
- [ ] **Step 3:** Update `docs/departments-rollout.md:96`: lookup now needs sign-in and is scoped to the caller's default department; list the "Known limits" above; update the 46/45 count; keep the rule that no second-department data may be created until `DEPARTMENT_SCOPE_PENDING` is empty. Update the spec per "Deviations".
- [ ] **Step 4: Verify** `npx tsc --noEmit -p .`, `npm run lint` (no `react-hooks/exhaustive-deps` warnings), `npx vitest run` all pass. Manual check only against a **test** database, never production (`.env.local` points at production, see AI_WORKSPACE rule 05): signed-out `/mobile` goes to `/login`; signed-in MOB user sees only MOB items; LIFF loads the list. If no test database is available, report that the manual check was not done.
- [ ] **Step 5: Commit** components and docs: `Update: mobile screens handle sign-in for lookup`.

---

## Self-review notes
- Spec coverage: identity + default department + guard-test change (Task 1), Vendor / no-department (Task 1), scoped queries and flag-off (Task 2), PENDING shrink (Task 2), callers and docs (Task 3), barcode-patterns question (unchanged, listed as a known limit).
- Reviewer items folded in: LIFF stale-closure and effect (Task 3), LINE-header precedence (Task 1), real-SQL tests (Task 1 DB file), 401 for revoked sessions (Task 1), `ALL` guard and safe errors (Task 2), narrow schema catch (Task 1), no-router wording (Task 3), comment/ALLOWED line fixes (Task 1), PENDING counts (Task 2, 3), fixture notes (Task 2), `no-store` (Task 2).
