import sql from "@/lib/db";

// Gate for the multi-department code paths (migrations v30-v34).
//
// The code is deployed BEFORE the migrations run in production, so every department-aware path must be able to
// fall back to the legacy behavior. With DEPARTMENTS_ENABLED unset this module never touches the database.
// With the flag on, the schema is checked once per CACHE_MS. Only a CONFIRMED answer is cached for that long:
// "ready", or "the schema is missing" (the probe saw it missing, or SQLSTATE 42P01/42703). A transient probe error
// (network blip, timeout) never turns a ready system into "legacy": if it was seen ready it stays ready (so the real
// query fails loudly instead of silently dropping department filtering); if it was never seen ready the answer is
// false, retried after only RETRY_MS.

const CACHE_MS = 60_000;
const RETRY_MS = 5_000;

type Cache = { ready: boolean; expiresAt: number; warned: boolean };

let cache: Cache | null = null;
let pending: Promise<boolean> | null = null;
let everReady = false;
let transientWarned = false;
// Bumped by markDepartmentsNotReady and the test reset, so a probe that started earlier cannot overwrite the newer state.
let generation = 0;
let clock: () => number = () => Date.now();

/** Test hook: replace the clock used for the 60 s cache. Pass nothing to restore Date.now. */
export function setDepartmentsClockForTests(fn?: () => number) {
  clock = fn ?? (() => Date.now());
}

/** Test hook: forget the cached result. */
export function resetDepartmentsFlagForTests() {
  cache = null;
  pending = null;
  everReady = false;
  transientWarned = false;
  generation++;
}

export function departmentsFlagOn(): boolean {
  return process.env.DEPARTMENTS_ENABLED === "true";
}

/** True for "undefined table" (42P01) / "undefined column" (42703), i.e. the department schema is not there. */
export function isMissingDepartmentSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "42P01" || code === "42703";
}

function remember(ready: boolean, reason?: string) {
  const previous = cache;
  const alreadyWarned = previous !== null && !previous.ready && previous.warned && clock() < previous.expiresAt;
  if (!ready && !alreadyWarned) {
    console.warn(`[departments] DEPARTMENTS_ENABLED but schema not ready: ${reason ?? "unknown"}`);
  }
  if (ready) {
    everReady = true;
    transientWarned = false;
  } else {
    everReady = false;
  }
  cache = { ready, expiresAt: clock() + CACHE_MS, warned: !ready };
}

async function probeSchema(): Promise<boolean> {
  const gen = generation;
  // A newer markDepartmentsNotReady / reset wins over this (older) probe.
  const settle = (result: boolean, store: () => void) => {
    if (gen !== generation) return cache?.ready ?? false;
    store();
    return result;
  };
  try {
    // One round trip. The table list is the 18 tables that receive department_id in upgrade_v31.
    const rows = await sql`
      SELECT
        (to_regclass('public.user_departments') IS NOT NULL) AS has_user_departments,
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'departments' AND column_name IN ('code', 'is_active')) AS department_cols,
        (SELECT count(DISTINCT table_name) FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'department_id'
            AND table_name IN ('master_data', 'inventory', 'logs', 'vendors', 'vendor_item_aliases', 'purchase_orders', 'shipments',
              'shipment_batches', 'count_sessions', 'count_work_orders', 'reagent_loans', 'barcode_pattern_v2',
              'barcode_patterns', 'notification_outbox', 'reagent_types', 'job_types', 'machine_types', 'lab_profile')) AS scoped_tables,
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'master_data' AND column_name = 'item_code') AS item_code_cols,
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('session_version', 'account_status')) AS user_cols
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    const missing: string[] = [];
    if (!row) {
      missing.push("no result");
    } else {
      if (row.has_user_departments !== true) missing.push("user_departments");
      if (Number(row.department_cols) !== 2) missing.push("departments.code/is_active");
      if (Number(row.scoped_tables) !== 18) missing.push("department_id columns");
      if (Number(row.item_code_cols) !== 1) missing.push("master_data.item_code");
      if (Number(row.user_cols) !== 2) missing.push("users.session_version/account_status");
    }
    if (missing.length > 0) {
      return settle(false, () => remember(false, `missing ${missing.join(", ")}`));
    }
    return settle(true, () => remember(true));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingDepartmentSchemaError(error)) {
      return settle(false, () => remember(false, `check failed (${message})`));
    }
    // Transient error: not a confirmed absence, so never cache "not ready" for the long period.
    return settle(everReady, () => {
      if (!transientWarned) {
        transientWarned = true;
        console.warn(`[departments] readiness check failed, not caching (${message}); ${everReady ? "keeping ready" : "treating as not ready"}`);
      }
      cache = { ready: everReady, expiresAt: clock() + RETRY_MS, warned: false };
    });
  }
}

/** Never throws. Flag off: false with zero sql calls. */
export async function departmentsReady(): Promise<boolean> {
  if (!departmentsFlagOn()) return false;
  if (cache && clock() < cache.expiresAt) return cache.ready;
  if (!pending) {
    const current: Promise<boolean> = probeSchema().finally(() => {
      if (pending === current) pending = null;
    });
    pending = current;
  }
  return pending;
}

/** A department-aware query hit a missing table/column: fall back to the legacy path for the next 60 s. */
export function markDepartmentsNotReady(reason: string): void {
  generation++;
  remember(false, reason);
}
