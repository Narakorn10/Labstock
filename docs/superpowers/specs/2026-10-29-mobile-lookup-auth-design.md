# `/api/mobile/lookup`: require sign-in and scope by department (short design)

Date: 2026-10-29. Size: small change (one route, its callers, tests, docs). Status: waiting for owner approval.

## Intent and why
`GET /api/mobile/lookup` needs no sign-in and returns items, lots and quantities of **every** department
(`src/app/api/mobile/lookup/route.ts:5-58`; `docs/departments-rollout.md:96`). It is one of the last two entries in
`DEPARTMENT_SCOPE_PENDING`, and it must be fixed **before** real data for the second department (MOB, id 2) is entered.
The owner decided: the caller must be signed in first. The mobile side will later become a PWA (separate project).

## Goals
- No sign-in, no data (401). Sign-in is checked **before** anything about department readiness
  (lesson of 2026-10-26: a "not ready, fall back to legacy" path must never skip the identity check).
- A signed-in caller sees only the items and lots of the department that `/api/mobile/confirm` will act in.
- Remove `src/app/api/mobile/lookup/route.ts` from `DEPARTMENT_SCOPE_PENDING`.

## Non-goals
- No department picker on mobile and no PWA work (offline cache must be cleared on sign-out: noted for the PWA project).
- No change to `/api/mobile/confirm`, `line-auth`, `line-link`, or `auth/register`.

## Anti-goals
- Never take the department from the request (no header, query or body field) and never offer "all departments".
- No fail-open: errors in the department lookup must not return unscoped data to an anonymous caller.

## Approaches
Only one fits. Choosing the department from a code in the URL is not authentication (owner rejected it); a per-device key
is far bigger than needed because the web already has sign-in. Owner approved this approach on 2026-10-29.

## Design (calls marked **[call]** are mine, for the owner to check)
1. **Two ways to prove identity**, tried in this order:
   - Web / PWA: Auth.js session cookie. **[call]** Read the session username and `sessionVersion` (as
     `src/lib/auth-utils.ts:131-143` does) and call the existing `resolveUserDepartment({ requested: null, explicit: false })`,
     which picks the user's *default* department with the same ordering that `confirm` uses. This is deliberately **not**
     `getAuthenticatedUser`'s result, because that follows a department switched on the web and `confirm` does not.
   - LIFF: the page sends its LINE ID token in a header. **[call]** The header name is `X-Line-Id-Token` (GET has no body).
     Server: `verifyLineIdToken` -> `getLineLinkedUser` -> `resolveDepartmentForVerifiedUser`, exactly as `confirm` does.
     **[call]** This needs `src/app/api/mobile/lookup/route.ts` added to `ALLOWED` in
     `department-context.verified-usage.test.ts` (that guard exists so only LINE/PIN-verified flows use the function; this is one).
   - Neither proves identity -> 401.
2. Vendor (global or in that department) -> 403, same message as `confirm`. Inactive account / no usable department -> 403 with the
   same Thai message as `confirm`.
3. Query `master_data` and `inventory` filtered by the resolved department, using the same scope helper other migrated routes use
   (`getDepartmentScope` in `src/lib/scoped-db`). Response shape stays the same, so scanning code is untouched.
4. Switch off (`departmentsReady()` false) or missing-schema error: identity is still required, data is unfiltered (legacy single
   department), and `markDepartmentsNotReady` is called as in `confirm`.
5. Callers: `/mobile` pages (`mobile-home.tsx`, `mobile-stock-workflow.tsx`) treat 401 as "go to `/login`" (with a way back);
   `liff-dispense-workflow.tsx` sends the ID token it already holds.
6. Docs/tests: update `docs/departments-rollout.md:96`; shrink `DEPARTMENT_SCOPE_PENDING`; add route tests (no sign-in 401,
   Vendor 403, MOB user sees only MOB, CC user sees only CC, flag off still needs sign-in, LINE path).

## Left to the builder
- Whether barcode patterns (`loadRuntimeBarcodePatterns`) are per-department or global: check and follow the existing table list.
- Exact `/login` return-URL handling, following the existing login page.

## User-visible change
A shared phone that opens `/mobile` and only enters a PIN at confirm time stops working: everyone signs in first.
No production change until deploy; no migration, no new env var.
