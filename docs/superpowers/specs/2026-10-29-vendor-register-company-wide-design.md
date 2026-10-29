# Vendor sign-up: one account per company, placed in the company's own room (short design)

Date: 2026-10-29 (revised the same day after the plan review). Size: small change (register route, one small helper, tests, docs).
Status: approved by the owner in conversation ("ใช่" to the anchor-room proposal and to keeping `UNIQUE (name)`); this file records it.

## Intent and why
`auth/register` is the last entry in `DEPARTMENT_SCOPE_PENDING`, and the rule "no data in a second department until the list
is empty" waits on it. The real blocker is the open question 3 ("a Vendor company shared by several rooms").
Owner decision: **one account per company, which sees what that company sells to.** Today a Vendor who picks a company of room B is
created in room CC and then cannot be activated (`src/app/api/users/[username]/account-status/route.ts:104-124` requires the company
to be approved in the account's own room).

What the code really does for a Vendor (found by the plan review): shipments and PO **reads** are company-wide ("policy A"), but the
dashboard, settings lists, purchase suggestions, PO proposing and master writes still use the **room of the Vendor account**
(`dashboard/route.ts:49-84`, `settings/route.ts:51-66`, `purchase-orders/suggest/route.ts:28-29`, `purchase-orders/route.ts:137-147`,
`master/route.ts:149-191`). So the room where the account lives matters, and putting a MOB-only company's account in CC would show
an empty dashboard and write master data into CC.

## Goals
- A Vendor can sign up for a company approved in **any active room that has a code**, and the account is created in **that company's
  room**, so room-scoped Vendor features work in the company's own room and activation passes unchanged.
- The sign-up page keeps a pick-from-list control (owner: no free text, so the stored name always equals `vendors.name`).
  A company that exists in several rooms appears **once**.
- `auth/register` leaves `DEPARTMENT_SCOPE_PENDING`; the list becomes empty.

## Non-goals
- No change to `account-status` (the existing "approved in the account's own room" check keeps working), `members` (Vendors still
  cannot be added to a room), lab sign-up, the "request a new company" flow, or any Vendor route.
- `UNIQUE (name)` on `vendors` (`vendors_name_key`) is kept (owner agreed 2026-10-29): a company has one row and one spelling system-wide.
- Signed-out visitors can still see the names of all companies approved in usable rooms (owner accepted this risk).
- Admin-created Vendor users (`users/route.ts` POST) and `users/[username]/route.ts` PATCH can still set any company text without this check
  (pre-existing, out of scope; recorded in the docs).

## Anti-goals
- A name that does not match a stored `vendors.name` exactly must never be stored in `users.vendor`.
- A Vendor account must never be created in a room other than the room of the exact `vendors` row it matched (request-mode
  accounts, which have no company yet, keep going to the default room CC as today).

## Approaches
Only one fits (owner picked it): company-wide list, account placed in the company's room. Placing every Vendor in CC was
rejected after the review (empty dashboard, master writes into CC); free text and per-room accounts were rejected by the owner.

## Design (calls marked **[call]** are mine)
1. **New helper `src/lib/vendor-registry.ts`** (imports `scoped-db`, uses the explicit scope `{ mode: "all" }` with a comment that this is
   a deliberate unfiltered read):
   - `listApprovedVendorNames(): Promise<string[]>` -> distinct exact names, approved, whose room is active and has a code, ordered by name.
   - `findApprovedVendor(name: string): Promise<{ name: string; departmentId: number | null } | null>` -> the matched row: case-insensitive
     match; the spelling equal to the input comes first, then the default room CC, then the lowest department id **[call]**.
     `departmentId` is the room of that row; it is `null` when the department switch is off (legacy).
   Switch off or schema missing: the helper runs exactly the legacy SQL (no `department_id`, `departments`, `user_departments`).
2. **`auth/register`**: GET uses `listApprovedVendorNames()`; POST (existing company) uses `findApprovedVendor()`, stores the returned exact
   name, and when departments are on creates the user + membership in the returned `departmentId` (not CC). No direct `vendors` query remains.
   Lab accounts and request-mode Vendors are unchanged (CC for request-mode).
3. **`DEPARTMENT_SCOPE_PENDING`**: remove `src/app/api/auth/register/route.ts` (the file no longer queries a department table directly).
4. **Docs**: update `docs/departments-rollout.md` (the ~line 201-204 caveat; a final section; Known limits below) and record the decision
   in `AI_WORKSPACE/PROJECTS/lab-stock-nextjs/decisions.md`.

## Known limits to document
- A company that sells to two rooms has its account in one room (CC if the company exists there, else the lowest room id): the
  dashboard/settings/proposals/master of the Vendor show that room only; shipments and PO reads still span rooms.
- A room cannot add a company whose exact name already exists in another room (`vendors_name_key`, error 23505).
- Names differing only by capitalisation across rooms are listed separately (never merged).
- Activation is unchanged: a request-mode Vendor whose company is later approved in a room other than the account's room still cannot
  be activated until the membership is moved (existing behaviour and message).

## Tests
Helper (PGlite): distinct list; unusable rooms (inactive / no code) excluded; case-only spellings both listed; exact spelling wins; CC preferred
over a lower-priority room; lowest id otherwise; flag off runs no department SQL; schema error falls back to legacy (unit test with the flag module mocked).
Register (PGlite, existing file style, no mock of the helper, `vendors_name_key` kept): company only in room B -> account in room B and the whole
membership row is `{ room B, role null, is_default true }`, `users.vendor` is the exact stored name; company in CC -> CC; company only in an inactive room
-> 400; existing-company match without a department id while the route sees departments ready -> 503, nothing created; the recorded-SQL test for the
switch off still passes. "Listed once" and "CC preferred over a lower id" need the same name or case-spellings in two rooms, which the kept constraint
forbids for exact duplicates, so they are tested only in the helper's own database (where the constraint is dropped).
Coverage test passes with the empty list.

## User-visible change
A Vendor of a MOB-only company can sign up and be activated with a working account in room MOB. No migration, no new env var.
