# LabStock Stability Handoff Checklist

> Goal: keep LabStock stable, data-correct, and safe to deploy.
>
> Delete this file only when all checklist items are complete, deploy verification is done, and no handoff remains.

## Current State

- Real repo: `C:\Users\HP Probook 440 G9\lab-stock-nextjs`
- Branch: `main`
- Latest committed commit currently on disk: `0430cb9 Hotfix: stabilize auth shell and LINE stock lookup`
- Working tree: local changes completed but not yet committed from this environment
- Limitation in this Codex session: `.git` is not writable here, so commit/push could not be executed

## Completed In This Session

- Repo-wide ESLint cleanup completed
- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npm run build` passes
- Purchase order, vendor order, borrow, lend, analysis, barcode settings, report modal, API route, migration, and tracking-provider lint debt cleaned up
- Frontend build no longer depends on fetching Google Fonts during build
- `src/app/layout.tsx` now uses local/system font styling via `src/app/globals.css`
- `next.config.ts` now sets `turbopack.root` and enables `experimental.workerThreads`
- Local `spawn EPERM` during Next TypeScript phase was avoided by switching build workers to worker threads

## Still Not Done

- No new Git commit created in this session
- No push performed
- No deploy performed
- No manual smoke test completed
- No production verification completed

## Verification Done

- [x] repo-wide lint
- [x] focused lint per cleanup batch
- [x] TypeScript no-emit
- [x] production build in the real repo

## Remaining Checklist

### 1. Git And Release

- [ ] Create a Git commit from a Git-writable environment
- [ ] Push only after explicit approval
- [ ] Record the new commit hash

### 2. Core Smoke Test

- [ ] Confirm login works
- [ ] Confirm `/mobile` loads correctly
- [ ] Test mobile scan/lookup with a known reagent or lot
- [ ] Confirm receive page loads and shows current reagent data
- [ ] Confirm dispense page loads and shows current reagent data
- [ ] Confirm count page loads and stock display is plausible
- [ ] Confirm permissions page loads current roles and permissions

### 3. Stock Data Correctness

- [ ] Pick 1 known reagent and compare quantity across inventory, mobile, receive, dispense, and count
- [ ] Confirm lot number and expiry date display correctly
- [ ] Confirm min stock is used consistently for low-stock detection
- [ ] Confirm receive increases stock correctly
- [ ] Confirm dispense decreases stock correctly
- [ ] Confirm count/reconcile does not duplicate or erase stock

### 4. Notifications And RBAC

- [ ] Confirm notification environment variables are present
- [ ] Test expiry notification flow
- [ ] Test low-stock notification flow
- [ ] Test weekly stock summary after count workflow
- [ ] Test vendor notification path if used
- [ ] Verify `/master/permissions` can save role permissions
- [ ] Verify normal user access vs admin-only access

### 5. Deploy Readiness

- [ ] Deploy after commit/push approval
- [ ] Test the smallest affected production flow after deploy
- [ ] Delete this file when no handoff remains

## Suggested Next Work Order

1. Commit from a Git-writable environment.
2. Push only if approved.
3. Run the smallest manual smoke test set: login, mobile, receive, dispense, count, permissions.
4. Validate one known reagent end to end.
5. Test notification and RBAC paths that matter now.
6. Deploy and verify the smallest affected production flow.
