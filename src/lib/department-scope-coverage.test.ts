import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guard against forgotten department filters.
//
// Rule: every source file (API route or src/lib module) whose SQL reads or writes one of the 18 department tables
//   (FROM | JOIN | INTO | UPDATE <table>)
// must import scoped-db (so it can scope the query; "@/lib/scoped-db" or a relative path such as "./scoped-db" or
// "../lib/scoped-db"), OR be listed in DEPARTMENT_SCOPE_PENDING below.
//
// Second rule: no file under src/app OUTSIDE src/app/api (pages, server actions, layouts) may import the database
// directly ("@/lib/db"), because those would bypass the scan above. A file that really needs it must be listed in
// APP_DB_IMPORT_ALLOWED with a reason (deliberate and reviewable). The list is empty today.
//
// The list can only SHRINK: when a file is migrated to scoped-db, delete it from the list. The test fails if a listed
// file already imports scoped-db, no longer exists, or no longer touches a department table, so stale entries are
// caught. Adding a new file to the list is a deliberate, reviewable act.
//
// Child tables reached through a parent (purchase_order_items, count_work_order_*) are intentionally not scanned;
// they are scoped through their parent row.

export const DEPARTMENT_TABLES = [
  "master_data", "inventory", "logs", "vendors", "vendor_item_aliases", "purchase_orders", "shipments",
  "shipment_batches", "count_sessions", "count_work_orders", "reagent_loans", "barcode_pattern_v2",
  "barcode_patterns", "notification_outbox", "reagent_types", "job_types", "machine_types", "lab_profile",
];

// Paths are relative to the repo root, forward slashes, sorted.
export const DEPARTMENT_SCOPE_PENDING: string[] = [
  "src/app/api/auth/register/route.ts",
  "src/app/api/dashboard/route.ts",
  "src/app/api/inventory/reconcile/route.ts",
  "src/app/api/liff/orders/[id]/route.ts",
  "src/app/api/liff/orders/bootstrap/route.ts",
  "src/app/api/liff/orders/route.ts",
  "src/app/api/line-webhook/route.ts",
  "src/app/api/logs/route.ts",
  "src/app/api/master/[itemId]/status/route.ts",
  "src/app/api/master/route.ts",
  "src/app/api/master/shelf-life/route.ts",
  "src/app/api/mobile/lookup/route.ts",
  "src/app/api/notifications/expiring-soon/route.ts",
  "src/app/api/notifications/outbox/[id]/route.ts",
  "src/app/api/notifications/outbox/route.ts",
  "src/app/api/notifications/vendor-low-stock/route.ts",
  "src/app/api/notifications/weekly-stock-summary/route.ts",
  "src/app/api/purchase-orders/[id]/route.ts",
  "src/app/api/purchase-orders/route.ts",
  "src/app/api/reagent-loans/route.ts",
  "src/app/api/settings/barcode-v2/[id]/activate/route.ts",
  "src/app/api/settings/barcode-v2/[id]/deactivate/route.ts",
  "src/app/api/settings/barcode-v2/[id]/route.ts",
  "src/app/api/settings/barcode-v2/route.ts",
  "src/app/api/settings/barcodes/route.ts",
  "src/app/api/settings/reagent-orders/route.ts",
  "src/app/api/settings/route.ts",
  "src/app/api/stations/catalog/route.ts",
  "src/app/api/usage/route.ts",
  "src/app/api/users/[username]/account-status/route.ts",
  "src/app/api/vendor/shipments/[id]/route.ts",
  "src/app/api/vendor/shipments/ocr/route.ts",
  "src/app/api/vendor/shipments/orders/route.ts",
  "src/app/api/vendor/shipments/route.ts",
  "src/lib/barcode-learning-v2.ts",
  "src/lib/barcode-runtime.ts",
  "src/lib/bot-stock-queries.ts",
  "src/lib/count-work-orders.ts",
  "src/lib/line-liff-ordering.ts",
  "src/lib/notification-outbox.ts",
  "src/lib/po-communication.ts",
  "src/lib/purchase-order-creation.ts",
  "src/lib/purchase-order-overdue.ts",
  "src/lib/purchase-order-receipt.ts",
  "src/lib/purchase-order-review.ts",
  "src/lib/purchase-order-status.ts",
  "src/lib/purchase-order-suggestions.ts",
  "src/lib/reagent-usage-insights.ts",
  "src/lib/shelf-life.ts",
  "src/lib/tracking-providers/manual.ts",
];

// Files under src/app (outside src/app/api) that import "@/lib/db" directly. Generated from reality: none today.
export const APP_DB_IMPORT_ALLOWED: string[] = [];

// Only these exact helper files are excluded from the scan; any NEW file named department-* is scanned like the rest.
const EXCLUDED_BASENAMES = new Set([
  "scoped-db.ts",
  "departments-flag.ts",
  "department-context.ts",
  "department-switch.ts",
  "department-scope-coverage.test.ts",
  "errors.ts",
]);

const ROOT = process.cwd();
const TABLE_HIT = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:public\\.)?(?:${DEPARTMENT_TABLES.join("|")})\\b`, "i");
const SCOPED_DB_IMPORT = /from\s+["'](?:@\/lib\/|(?:\.{1,2}\/)+(?:[\w-]+\/)*)scoped-db["']/;
const DB_IMPORT = /(?:from\s+|import\(\s*|require\(\s*)["'](?:@\/lib\/db|(?:\.{1,2}\/)+(?:[\w-]+\/)*db)["']/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "test" || name === "node_modules") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function isExcluded(rel: string): boolean {
  const base = path.posix.basename(rel);
  if (/\.test\.tsx?$/.test(base)) return true;
  if (EXCLUDED_BASENAMES.has(base) || base.startsWith("department-fixtures") || base.startsWith("api-response")) return true;
  return false;
}

function candidateFiles(): string[] {
  const routes = walk(path.join(ROOT, "src", "app", "api")).filter((file) => path.basename(file) === "route.ts");
  const libs = walk(path.join(ROOT, "src", "lib")).filter((file) => /\.tsx?$/.test(file));
  return [...routes, ...libs]
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .filter((rel) => !isExcluded(rel))
    .sort();
}

function appFilesOutsideApi(): string[] {
  const apiDir = path.join(ROOT, "src", "app", "api");
  return walk(path.join(ROOT, "src", "app"))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith(apiDir + path.sep))
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .sort();
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("department scope coverage", () => {
  const files = candidateFiles();
  const hits = files.filter((rel) => TABLE_HIT.test(read(rel)));

  it("scans a plausible number of files", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("every file touching a department table imports @/lib/scoped-db or is listed as pending", () => {
    const unscoped = hits.filter((rel) => !SCOPED_DB_IMPORT.test(read(rel)) && !DEPARTMENT_SCOPE_PENDING.includes(rel));
    expect(
      unscoped,
      `These files query a department table without importing "@/lib/scoped-db". Scope the query, or (temporarily) add the file to DEPARTMENT_SCOPE_PENDING.`,
    ).toEqual([]);
  });

  it("recognizes both the alias and relative import styles of scoped-db", () => {
    for (const ok of [
      `import { andDept } from "@/lib/scoped-db";`,
      `import { andDept } from "./scoped-db";`,
      `import { andDept } from "../lib/scoped-db";`,
      `import { andDept } from '../../lib/scoped-db'`,
    ]) expect(SCOPED_DB_IMPORT.test(ok), ok).toBe(true);
    for (const bad of [`import x from "@/lib/scoped-db-other";`, `import x from "scoped-db";`, `// scoped-db`]) {
      expect(SCOPED_DB_IMPORT.test(bad), bad).toBe(false);
    }
  });

  it("no page / server action under src/app (outside api) imports the database directly", () => {
    const offenders = appFilesOutsideApi().filter((rel) => DB_IMPORT.test(read(rel)) && !APP_DB_IMPORT_ALLOWED.includes(rel));
    expect(
      offenders,
      `These files under src/app import "@/lib/db" directly and would bypass department scoping. Move the query behind an API route / scoped helper, or (deliberately) add the file to APP_DB_IMPORT_ALLOWED.`,
    ).toEqual([]);
    expect(APP_DB_IMPORT_ALLOWED).toEqual([...new Set(APP_DB_IMPORT_ALLOWED)].sort());
    const stale = APP_DB_IMPORT_ALLOWED.filter((rel) => !existsSync(path.join(ROOT, rel)) || !DB_IMPORT.test(read(rel)));
    expect(stale, "These allowed files no longer exist or no longer import the db: remove them from APP_DB_IMPORT_ALLOWED.").toEqual([]);
  });

  it("recognizes direct db imports", () => {
    for (const ok of [`import sql from "@/lib/db";`, `import sql from "../../lib/db"`, `const m = await import("@/lib/db")`]) {
      expect(DB_IMPORT.test(ok), ok).toBe(true);
    }
    expect(DB_IMPORT.test(`import x from "@/lib/db-helpers";`)).toBe(false);
  });

  it("pending list is sorted and has no duplicates", () => {
    expect(DEPARTMENT_SCOPE_PENDING).toEqual([...new Set(DEPARTMENT_SCOPE_PENDING)].sort());
  });

  it("pending list has no migrated file (it can only shrink)", () => {
    const migrated = DEPARTMENT_SCOPE_PENDING.filter((rel) => existsSync(path.join(ROOT, rel)) && SCOPED_DB_IMPORT.test(read(rel)));
    expect(migrated, "These files already import @/lib/scoped-db: remove them from DEPARTMENT_SCOPE_PENDING.").toEqual([]);
  });

  it("pending list has no stale entry (file missing or no longer touching a department table)", () => {
    const stale = DEPARTMENT_SCOPE_PENDING.filter((rel) => !existsSync(path.join(ROOT, rel)) || !hits.includes(rel));
    expect(stale, "These files no longer exist or no longer query a department table: remove them from DEPARTMENT_SCOPE_PENDING.").toEqual([]);
  });
});
