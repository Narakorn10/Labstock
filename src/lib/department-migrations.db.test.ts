import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { PROD_SCHEMA_DDL, PROD_SEED_SQL } from "@/test/pglite-prod-schema";
import { splitSqlStatements } from "../../scripts/sql-statements.mjs";

// Runs upgrade_v30..v35 (and their rollbacks) against an in-memory Postgres that mirrors the real production
// schema. Each file is executed statement-by-statement with the same splitter the real runner uses
// (scripts/apply-migration.mjs), so CREATE INDEX CONCURRENTLY is not wrapped in an implicit transaction.
// The ONLY rewrite: the keyword CONCURRENTLY is removed from CREATE/DROP INDEX, because PGlite (single-user mode)
// fails CREATE INDEX CONCURRENTLY with "tuple concurrently updated". Everything else (including SET lock_timeout)
// runs exactly as written.
// What PGlite cannot prove: that CONCURRENTLY itself works, lock behaviour / lock_timeout under concurrent traffic, that CONCURRENTLY does not block
// writers, and that ADD COLUMN ... DEFAULT is a metadata-only change on a large Neon table (PGlite is PG17 so the
// semantics are the same, but there is no concurrent load or table size to observe).

const FORWARD = [
  "upgrade_v30_departments_core.sql",
  "upgrade_v31_department_columns.sql",
  "upgrade_v32_department_constraints.sql",
  "upgrade_v33_item_code.sql",
  "upgrade_v34_indexes.sql",
  "upgrade_v35_room_admin_slot.sql",
];
const ROLLBACK = [
  "upgrade_v35_room_admin_slot_rollback.sql",
  "upgrade_v34_indexes_rollback.sql",
  "upgrade_v33_item_code_rollback.sql",
  "upgrade_v32_department_constraints_rollback.sql",
  "upgrade_v31_department_columns_rollback.sql",
  "upgrade_v30_departments_core_rollback.sql",
];

const DEPT_TABLES = [
  "master_data", "inventory", "logs", "vendors", "vendor_item_aliases", "purchase_orders", "shipments",
  "shipment_batches", "count_sessions", "count_work_orders", "reagent_loans", "barcode_pattern_v2",
  "barcode_patterns", "notification_outbox", "reagent_types", "job_types", "machine_types", "lab_profile",
];
const ALL_TABLES = [
  "departments", "users", ...DEPT_TABLES, "app_events", "purchase_order_events",
];

async function applyFile(db: PGlite, file: string) {
  const text = readFileSync(path.resolve(process.cwd(), file), "utf8").replace(/\bCONCURRENTLY\s+/g, "");
  for (const statement of splitSqlStatements(text)) {
    try {
      await db.exec(statement);
    } catch (error) {
      throw new Error(`${file} failed on statement:\n${statement}\n${(error as Error).message}`);
    }
  }
}

async function applyAll(db: PGlite, files: string[]) {
  for (const file of files) await applyFile(db, file);
}

async function newDb() {
  const db = new PGlite();
  await db.exec(PROD_SCHEMA_DDL);
  await db.exec(PROD_SEED_SQL);
  return db;
}

async function counts(db: PGlite) {
  const result: Record<string, number> = {};
  for (const table of ALL_TABLES) {
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
    result[table] = Number(rows[0].n);
  }
  return result;
}

// departments gains the default row and user_departments is new, so those two are checked separately.
function omitDepartmentTables(c: Record<string, number>) {
  return { ...c, departments: undefined, user_departments: undefined };
}

async function scalar<T = unknown>(db: PGlite, text: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(text, params)).rows[0]?.v;
}

const columnExists = async (db: PGlite, table: string, column: string) =>
  (await scalar<number>(db, "SELECT count(*)::int AS v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2", [table, column])) === 1;

const defaultDeptId = (db: PGlite) => scalar<number>(db, "SELECT id AS v FROM departments WHERE code = 'CC'");

describe("splitSqlStatements", () => {
  it("keeps DO blocks, strings and comments intact", () => {
    const parts = splitSqlStatements(`
      -- a; comment
      SET x = 1;
      /* block; */ DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;
      SELECT 'a;b', "c;d";
      CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;
    `);
    expect(parts).toHaveLength(4);
    expect(parts[1]).toContain("PERFORM 1; PERFORM 2;");
    expect(parts[2]).toBe(`SELECT 'a;b', "c;d"`);
    expect(parts[3]).toContain("$body$ SELECT 1; $body$");
  });
});

describe("departments migrations v30-v34", () => {
  let db: PGlite;
  let before: Record<string, number>;
  let labId: number;

  beforeAll(async () => {
    db = await newDb();
    before = await counts(db);
    await applyAll(db, FORWARD);
    labId = (await defaultDeptId(db)) as number;
  }, 60_000);

  it("marks the existing 'ห้องปฏิบัติการเคมีคลินิก' (id 1) as the default department and creates no new row", async () => {
    const { rows } = await db.query<{ id: number; name: string; code: string | null; is_active: boolean }>("SELECT id, name, code, is_active FROM departments ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 1, name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC", is_active: true });
    expect(rows[1]).toMatchObject({ id: 2, name: "งานอณูชีววิทยา", code: null, is_active: true });
    expect(labId).toBe(1);
  });

  it("backfills every user into the default department with is_default and a NULL role (use users.role)", async () => {
    const { rows } = await db.query<{ username: string; role: string | null; is_default: boolean; department_id: number }>("SELECT username, role, is_default, department_id FROM user_departments ORDER BY username");
    expect(rows.every((row) => row.department_id === 1)).toBe(true);
    expect(rows).toEqual([
      { username: "admin1", role: null, is_default: true, department_id: labId },
      { username: "user1", role: null, is_default: true, department_id: labId },
      { username: "vendor1", role: null, is_default: true, department_id: labId },
    ]);
  });

  it("keeps all row counts and leaves no NULL department_id", async () => {
    const after = await counts(db);
    expect(omitDepartmentTables(after)).toEqual(omitDepartmentTables(before));
    for (const table of DEPT_TABLES) {
      expect(await scalar(db, `SELECT count(*)::int AS v FROM ${table} WHERE department_id IS NULL`), table).toBe(0);
      expect(await scalar(db, `SELECT count(*)::int AS v FROM ${table} WHERE department_id <> $1`, [labId]), table).toBe(0);
    }
    expect(await scalar(db, "SELECT count(*)::int AS v FROM master_data WHERE item_code IS DISTINCT FROM item_id")).toBe(0);
    expect(labId).toBe(1);
  });

  it("validates the foreign keys and NOT NULL, and leaves no helper CHECK behind", async () => {
    for (const table of [...DEPT_TABLES, "app_events"]) {
      const fk = await db.query<{ convalidated: boolean }>("SELECT convalidated FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2", [`public.${table}`, `${table}_department_id_fkey`]);
      expect(fk.rows, table).toEqual([{ convalidated: true }]);
      const nn = await scalar<number>(db, "SELECT count(*)::int AS v FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2", [`public.${table}`, `${table}_department_id_nn`]);
      expect(nn, table).toBe(0);
      const notNull = await scalar<boolean>(db, "SELECT attnotnull AS v FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'department_id'", [`public.${table}`]);
      expect(notNull, table).toBe(table !== "app_events");
    }
    expect(await scalar<boolean>(db, "SELECT attnotnull AS v FROM pg_attribute WHERE attrelid = 'public.master_data'::regclass AND attname = 'item_code'")).toBe(true);
    await expect(db.exec("INSERT INTO vendors (name, department_id) VALUES ('Bad', 9999)")).rejects.toThrow(/foreign key/);
    await expect(db.exec("INSERT INTO vendors (name, department_id) VALUES ('Bad', NULL)")).rejects.toThrow(/not-null|null value/);
  });

  it("creates the v34 indexes as valid indexes, alongside the old ones", async () => {
    const { rows } = await db.query<{ relname: string }>("SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid");
    expect(rows).toEqual([]);
    for (const name of ["uq_master_data_dept_item_code", "uq_vendors_dept_name", "uq_barcode_pattern_v2_dept_active_regex", "idx_logs_dept_timestamp", "idx_shipments_dept_vendor"]) {
      expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_indexes WHERE indexname = $1", [name]), name).toBe(1);
    }
    for (const name of ["vendors_name_key", "idx_count_sessions_one_draft_per_owner", "uq_barcode_pattern_v2_active_regex", "master_data_pkey"]) {
      expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_indexes WHERE indexname = $1", [name]), name).toBe(1);
    }
  });

  it("is idempotent: applying every file a second time changes nothing", async () => {
    const snapshot = async () => ({
      counts: await counts(db),
      indexes: (await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname")).rows,
      constraints: (await db.query<{ conname: string; convalidated: boolean }>("SELECT conname, convalidated FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname")).rows,
      departments: (await db.query("SELECT * FROM departments ORDER BY id")).rows,
    });
    const first = await snapshot();
    await applyAll(db, FORWARD);
    expect(await snapshot()).toEqual(first);
  }, 60_000);

  it("lets old-style INSERTs (no department_id / item_code) succeed in the default department", async () => {
    // master_data: item_id comes from the column default, item_code from the trigger.
    await db.exec("INSERT INTO master_data (name, unit) VALUES ('Old app item', 'box')");
    const generated = await db.query<{ item_id: string; item_code: string; department_id: number }>("SELECT item_id, item_code, department_id FROM master_data WHERE name = 'Old app item'");
    expect(generated.rows[0].item_id).toMatch(/^LAB-\d{6}$/);
    expect(generated.rows[0].item_code).toBe(generated.rows[0].item_id);
    expect(generated.rows[0].department_id).toBe(labId);

    // master_data with an explicit item_id and an empty item_code.
    await db.exec("INSERT INTO master_data (item_id, name, item_code) VALUES ('OLD-1', 'Old app item 2', '')");
    expect(await scalar(db, "SELECT item_code AS v FROM master_data WHERE item_id = 'OLD-1'")).toBe("OLD-1");

    await db.exec(`
      INSERT INTO inventory (item_id, lot_no, quantity) VALUES ('OLD-1', 'LX', 1);
      INSERT INTO vendors (name) VALUES ('Old vendor');
      INSERT INTO purchase_orders (po_number, vendor, created_by) VALUES ('PO-OLD-1', 'Old vendor', 'user1');
      INSERT INTO logs (item_id, action, username) VALUES ('OLD-1', 'RECEIVE', 'user1');
      INSERT INTO app_events (action, route, outcome) VALUES ('old', '/x', 'success');
    `);
    for (const [table, where] of [
      ["master_data", "item_id = 'OLD-1'"],
      ["inventory", "item_id = 'OLD-1'"],
      ["vendors", "name = 'Old vendor'"],
      ["purchase_orders", "po_number = 'PO-OLD-1'"],
      ["logs", "item_id = 'OLD-1'"],
    ]) {
      expect(await scalar(db, `SELECT department_id AS v FROM ${table} WHERE ${where}`), table).toBe(labId);
    }
    // app_events has no default on purpose.
    expect(await scalar(db, "SELECT department_id AS v FROM app_events WHERE action = 'old'")).toBeNull();
  });

  it("rejects a duplicate (department_id, item_code) but allows the same code in another department", async () => {
    await expect(db.exec("INSERT INTO master_data (item_id, name, item_code) VALUES ('DUP-ID', 'Dup', 'OLD-1')")).rejects.toThrow(/uq_master_data_dept_item_code/);

    const second = await scalar<number>(db, "INSERT INTO departments (name, code) VALUES ('Second', 'SEC') RETURNING id AS v");
    try {
      await db.exec(`INSERT INTO master_data (item_id, name, item_code, department_id) VALUES ('SEC-ID', 'Same code', 'OLD-1', ${second})`);
      // The OLD global unique vendors_name_key is deliberately still in place (it is swapped out in a later step),
      // so the same vendor name in two departments is still rejected for now; within one department it is rejected too.
      await db.exec(`INSERT INTO vendors (name, department_id) VALUES ('Second dept vendor', ${second})`);
      await expect(db.exec(`INSERT INTO vendors (name, department_id) VALUES ('Second dept vendor', ${second})`)).rejects.toThrow(/duplicate key/);
      await expect(db.exec(`INSERT INTO vendors (name, department_id) VALUES ('Vendor A', ${second})`)).rejects.toThrow(/vendors_name_key/);
    } finally {
      await db.exec(`DELETE FROM master_data WHERE department_id = ${second}; DELETE FROM vendors WHERE department_id = ${second}; DELETE FROM departments WHERE id = ${second}`);
    }
  });

  it("applies the rollbacks (twice, to prove idempotency) and then re-applies forward", async () => {
    // Remove rows added by the previous tests that did not exist before, so counts can be compared again.
    await db.exec(`
      DELETE FROM app_events WHERE action = 'old';
      DELETE FROM logs WHERE item_id = 'OLD-1';
      DELETE FROM purchase_orders WHERE po_number = 'PO-OLD-1';
      DELETE FROM vendors WHERE name = 'Old vendor';
      DELETE FROM inventory WHERE item_id = 'OLD-1';
      DELETE FROM master_data WHERE name LIKE 'Old app item%';
    `);
    expect(omitDepartmentTables(await counts(db))).toEqual(omitDepartmentTables(before));

    await applyAll(db, ROLLBACK);
    await applyAll(db, ROLLBACK);

    for (const table of [...DEPT_TABLES, "app_events"]) {
      expect(await columnExists(db, table, "department_id"), table).toBe(false);
    }
    expect(await columnExists(db, "master_data", "item_code")).toBe(false);
    expect(await columnExists(db, "departments", "code")).toBe(false);
    expect(await columnExists(db, "departments", "is_active")).toBe(false);
    expect(await scalar(db, "SELECT to_regclass('public.user_departments')::text AS v")).toBeNull();
    expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_trigger WHERE tgname = 'trg_master_data_item_code'")).toBe(0);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_indexes WHERE indexname LIKE 'uq\\_%dept\\_%' OR indexname LIKE 'idx\\_%dept\\_%'")).toBe(0);
    // Original indexes and all data are still there; both department rows are intentionally kept (rollback never deletes a department).
    expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_indexes WHERE indexname = 'vendors_name_key'")).toBe(1);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM departments")).toBe(2);
    expect((await db.query("SELECT id, name FROM departments ORDER BY id")).rows).toEqual([
      { id: 1, name: "ห้องปฏิบัติการเคมีคลินิก" },
      { id: 2, name: "งานอณูชีววิทยา" },
    ]);
    const afterRollback = await counts(db);
    expect(omitDepartmentTables(afterRollback)).toEqual(omitDepartmentTables(before));

    await applyAll(db, FORWARD);
    const again = await counts(db);
    expect(omitDepartmentTables(again)).toEqual(omitDepartmentTables(before));
    expect(await scalar(db, "SELECT count(*)::int AS v FROM departments")).toBe(2);
    expect(await scalar(db, "SELECT code AS v FROM departments WHERE id = 1")).toBe("CC");
    expect(await scalar(db, "SELECT code AS v FROM departments WHERE id = 2")).toBeNull();
    for (const table of DEPT_TABLES) {
      expect(await scalar(db, `SELECT count(*)::int AS v FROM ${table} WHERE department_id IS NULL`), table).toBe(0);
    }
  }, 60_000);

  it("refuses to roll back v31 once a row belongs to another department", async () => {
    const second = await scalar<number>(db, "INSERT INTO departments (name, code) VALUES ('Second', 'SEC') RETURNING id AS v");
    await db.exec(`INSERT INTO vendors (name, department_id) VALUES ('Other dept vendor', ${second})`);
    await applyAll(db, ROLLBACK.slice(0, 4));
    await expect(applyFile(db, ROLLBACK[4])).rejects.toThrow(/rollback refused/);
    expect(await columnExists(db, "vendors", "department_id")).toBe(true);
  }, 60_000);
});

describe("v35 room admin slot", () => {
  async function v35Db() {
    const db = await newDb();
    await applyAll(db, FORWARD);
    await db.exec("INSERT INTO users (username, password_hash, name, role) VALUES ('u3', 'x', 'U3', 'User'), ('u4', 'x', 'U4', 'User')");
    await db.exec("INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('u3', 1, NULL, false), ('u4', 1, NULL, false)");
    return db;
  }

  it("adds a nullable admin_slot and gives nobody a slot (no backfill)", async () => {
    const db = await v35Db();
    expect(await columnExists(db, "user_departments", "admin_slot")).toBe(true);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM user_departments WHERE admin_slot IS NOT NULL")).toBe(0);
    await db.close();
  });

  it("allows at most 2 room admins per room and rejects a duplicate slot or a slot outside 1-2", async () => {
    const db = await v35Db();
    await db.exec("UPDATE user_departments SET admin_slot = 1 WHERE username = 'user1' AND department_id = 1");
    await db.exec("UPDATE user_departments SET admin_slot = 2 WHERE username = 'u3' AND department_id = 1");
    await expect(db.exec("UPDATE user_departments SET admin_slot = 1 WHERE username = 'u4' AND department_id = 1")).rejects.toThrow(/user_departments_admin_slot_idx/);
    await expect(db.exec("UPDATE user_departments SET admin_slot = 3 WHERE username = 'u4' AND department_id = 1")).rejects.toThrow(/check/i);
    await db.close();
  });

  it("lets the same slot number exist in different rooms and a user hold slots in several rooms", async () => {
    const db = await v35Db();
    await db.exec("INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', 2, NULL, false)");
    await db.exec("UPDATE user_departments SET admin_slot = 1 WHERE username = 'user1'");
    await db.exec("INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('u3', 2, NULL, false)");
    await db.exec("UPDATE user_departments SET admin_slot = 2 WHERE username = 'u3' AND department_id = 2");
    expect(await scalar(db, "SELECT count(*)::int AS v FROM user_departments WHERE admin_slot IS NOT NULL")).toBe(3);
    await db.close();
  });

  it("is idempotent and its rollback removes only the slot (also when run twice or after v30 is gone)", async () => {
    const db = await v35Db();
    await applyFile(db, FORWARD[5]);
    await db.exec("UPDATE user_departments SET admin_slot = 1 WHERE username = 'user1'");
    await applyFile(db, ROLLBACK[0]);
    await applyFile(db, ROLLBACK[0]);
    expect(await columnExists(db, "user_departments", "admin_slot")).toBe(false);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM pg_indexes WHERE indexname = 'user_departments_admin_slot_idx'")).toBe(0);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM user_departments")).toBe(5);
    await applyAll(db, ROLLBACK.slice(1));
    await applyFile(db, ROLLBACK[0]);
    await db.close();
  }, 60_000);
});

describe("v30 default department", () => {
  it("sets code CC on the existing 'ห้องปฏิบัติการเคมีคลินิก' row instead of inserting a duplicate", async () => {
    const db = new PGlite();
    await db.exec(PROD_SCHEMA_DDL);
    await db.exec("INSERT INTO departments (name) VALUES ('ห้องปฏิบัติการเคมีคลินิก'), ('Other')");
    await applyFile(db, FORWARD[0]);
    const { rows } = await db.query<{ name: string; code: string | null }>("SELECT name, code FROM departments ORDER BY id");
    expect(rows).toEqual([{ name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC" }, { name: "Other", code: null }]);
    await db.close();
  });

  it("inserts 'ห้องปฏิบัติการเคมีคลินิก' with code CC on a fresh database where the row does not exist yet", async () => {
    const db = new PGlite();
    await db.exec(PROD_SCHEMA_DDL);
    await applyFile(db, FORWARD[0]);
    await applyFile(db, FORWARD[0]);
    const { rows } = await db.query<{ name: string; code: string | null }>("SELECT name, code FROM departments ORDER BY id");
    expect(rows).toEqual([{ name: "ห้องปฏิบัติการเคมีคลินิก", code: "CC" }]);
    await db.close();
  });

  it("does nothing when a row with code CC already exists", async () => {
    const db = new PGlite();
    await db.exec(PROD_SCHEMA_DDL);
    await db.exec("INSERT INTO departments (name) VALUES ('ห้องปฏิบัติการเคมีคลินิก'), ('Renamed default')");
    await db.exec("ALTER TABLE departments ADD COLUMN code text; UPDATE departments SET code = 'CC' WHERE name = 'Renamed default'");
    await applyFile(db, FORWARD[0]);
    const { rows } = await db.query<{ name: string; code: string | null }>("SELECT name, code FROM departments ORDER BY id");
    expect(rows).toEqual([{ name: "ห้องปฏิบัติการเคมีคลินิก", code: null }, { name: "Renamed default", code: "CC" }]);
    await db.close();
  });

  // docs/departments-rollout.md item 5 used to say re-running v30 is always safe. It is only safe while every user's
  // default department is CC and nobody has been removed from CC. These two tests pin down the limits.
  it("fails when re-run after a user's default department is not CC (one-default index, 23505)", async () => {
    const db = await newDb();
    await applyFile(db, FORWARD[0]);
    const roomId = await scalar<number>(db, "SELECT id AS v FROM departments WHERE code IS NULL ORDER BY id LIMIT 1");
    await db.query("UPDATE departments SET code = 'MB' WHERE id = $1", [roomId]);
    await db.query("DELETE FROM user_departments WHERE username = 'user1'");
    await db.query("INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('user1', $1, NULL, true)", [roomId]);
    await expect(applyFile(db, FORWARD[0])).rejects.toThrow(/user_departments_one_default_idx/);
    await db.close();
  });

  it("re-grants CC to a user who was removed from every room (revocation is not preserved)", async () => {
    const db = await newDb();
    await applyFile(db, FORWARD[0]);
    await db.query("DELETE FROM user_departments WHERE username = 'user1'");
    await applyFile(db, FORWARD[0]);
    const { rows } = await db.query<{ department_id: number; is_default: boolean }>("SELECT department_id, is_default FROM user_departments WHERE username = 'user1'");
    expect(rows).toEqual([{ department_id: 1, is_default: true }]);
    await db.close();
  });

  it("never uses 'LAB' as a department code in any migration file", () => {
    for (const file of [...FORWARD, ...ROLLBACK]) {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(text, file).not.toMatch(/LAB/);
    }
    // The runner's help text must not mention it either.
    expect(readFileSync(path.resolve(process.cwd(), "scripts/apply-migration.mjs"), "utf8")).not.toMatch(/LAB/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v36: lab_profile per department. Kept separate on purpose: v36 is NOT in FORWARD/ROLLBACK above (and not in
// DEPARTMENT_MIGRATIONS in src/test/department-fixtures.ts), so nothing else is affected until the owner approves it.
// What PGlite cannot prove: the SET lock_timeout behaviour under concurrent traffic on the real Neon table, and the
// real constraint name on Neon (unknown; the migration finds the CHECK by its definition, test 4 covers a renamed one).
// ---------------------------------------------------------------------------------------------------------------
const V36 = "upgrade_v36_lab_profile_per_department.sql";
const V36_RB = "upgrade_v36_lab_profile_per_department_rollback.sql";

describe("v36 lab_profile per department", () => {
  // Fresh production-shaped database with v30-v35 applied (v36 NOT applied yet).
  async function baseDb() {
    const db = await newDb();
    await applyAll(db, FORWARD);
    return db;
  }
  const checkDefs = async (db: PGlite) =>
    (await db.query<{ conname: string; def: string }>(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND contype = 'c' ORDER BY conname",
    )).rows;
  // Same predicate the migration uses: valid, non-partial, non-expression unique index on exactly (department_id).
  const fullUniqueCount = (db: PGlite) =>
    scalar<number>(
      db,
      `SELECT count(*)::int AS v FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attname = 'department_id'
       WHERE i.indrelid = 'public.lab_profile'::regclass AND i.indisunique AND i.indisvalid AND i.indnatts = 1
         AND i.indkey[0] = a.attnum AND i.indpred IS NULL AND i.indexprs IS NULL`,
    );
  const constraintExists = async (db: PGlite, name: string) =>
    (await scalar<number>(db, "SELECT count(*)::int AS v FROM pg_constraint WHERE conrelid = 'public.lab_profile'::regclass AND conname = $1", [name])) === 1;
  // applyFile's error text contains the whole failing statement (including the RAISE texts), so match only the last
  // line = the message PostgreSQL actually raised. Otherwise a test could pass even if the check never fired.
  const raisedMessage = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e: Error) => e);
    expect(error, "expected the migration to throw").not.toBeNull();
    return (error as Error).message.trim().split("\n").pop() ?? "";
  };
  const idOneRow = async (db: PGlite) => (await db.query("SELECT * FROM lab_profile WHERE id = 1")).rows;
  const hasIdOneCheck = async (db: PGlite) => (await checkDefs(db)).some((c) => /^CHECK \(+id = 1\)+$/.test(c.def));

  it("1. forward drops the id = 1 CHECK, adds the unique constraint, and leaves row id 1 and all counts unchanged", async () => {
    const db = await baseDb();
    expect(await hasIdOneCheck(db)).toBe(true);
    const rowBefore = await idOneRow(db);
    const countsBefore = await counts(db);
    await applyFile(db, V36);
    expect(await hasIdOneCheck(db)).toBe(false);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(true);
    expect(await fullUniqueCount(db)).toBe(1);
    expect(await idOneRow(db)).toEqual(rowBefore);
    expect(rowBefore).toHaveLength(1);
    expect(await counts(db)).toEqual(countsBefore);
    await db.close();
  }, 60_000);

  it("2. a second department row inserts; a duplicate department_id is rejected (23505); id = 1 still returns CC", async () => {
    const db = await baseDb();
    await applyFile(db, V36);
    await db.query("INSERT INTO lab_profile (id, department_id, organization_name) VALUES (2, 2, 'Molecular')");
    expect(await scalar(db, "SELECT count(*)::int AS v FROM lab_profile")).toBe(2);
    await expect(db.query("INSERT INTO lab_profile (id, department_id) VALUES (3, 1)")).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("INSERT INTO lab_profile (id, department_id) VALUES (4, 2)")).rejects.toMatchObject({ code: "23505" });
    // Inserting without id fails loudly on the primary key (id DEFAULT 1) - v36 does not change that.
    await expect(db.query("INSERT INTO lab_profile (department_id) VALUES (2)")).rejects.toMatchObject({ code: "23505" });
    const { rows } = await db.query<{ id: number; department_id: number }>("SELECT id, department_id FROM lab_profile WHERE id = 1");
    expect(rows).toEqual([{ id: 1, department_id: await defaultDeptId(db) }]);
    await db.close();
  }, 60_000);

  it("3. running forward twice is idempotent (still exactly one qualifying unique)", async () => {
    const db = await baseDb();
    await applyFile(db, V36);
    const rowBefore = await idOneRow(db);
    await applyFile(db, V36);
    expect(await fullUniqueCount(db)).toBe(1);
    expect(await hasIdOneCheck(db)).toBe(false);
    expect(await idOneRow(db)).toEqual(rowBefore);
    await db.close();
  }, 60_000);

  it("4. a CHECK with a different name (weird_name) is still found by its definition and dropped", async () => {
    const db = await baseDb();
    await db.exec("ALTER TABLE lab_profile RENAME CONSTRAINT lab_profile_id_check TO weird_name");
    expect((await checkDefs(db)).map((c) => c.conname)).toContain("weird_name");
    await applyFile(db, V36);
    expect(await hasIdOneCheck(db)).toBe(false);
    expect((await checkDefs(db)).map((c) => c.conname)).not.toContain("weird_name");
    await db.close();
  }, 60_000);

  it("5. before v31 (no department_id) it stops with a message about v31", async () => {
    const db = await newDb();
    await applyFile(db, FORWARD[0]);
    expect(await raisedMessage(applyFile(db, V36))).toMatch(/run v31\/v32 first/);
    expect(await hasIdOneCheck(db)).toBe(true);
    await db.close();
  }, 60_000);

  it("6. a failing pre-check (duplicate department_id) throws and leaves no unique behind", async () => {
    const db = await baseDb();
    await db.exec("ALTER TABLE lab_profile DROP CONSTRAINT lab_profile_id_check");
    await db.exec("INSERT INTO lab_profile (id) VALUES (2)"); // department_id defaults to CC -> duplicate of row 1
    expect(await raisedMessage(applyFile(db, V36))).toMatch(/duplicate department_id/);
    expect(await fullUniqueCount(db)).toBe(0);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(false);
    await db.close();
  }, 60_000);

  it("7. department_id nullable => forward throws; real v32 state (helper _nn already dropped, real NOT NULL) => passes", async () => {
    const db = await baseDb();
    // State right after the real v32: real NOT NULL, the temporary helper constraint is gone.
    expect(await scalar<boolean>(db, "SELECT attnotnull AS v FROM pg_attribute WHERE attrelid = 'public.lab_profile'::regclass AND attname = 'department_id'")).toBe(true);
    expect(await constraintExists(db, "lab_profile_department_id_nn")).toBe(false);
    // Simulate "v32 did not finish": nullable column.
    await db.exec("ALTER TABLE lab_profile ALTER COLUMN department_id DROP NOT NULL");
    expect(await raisedMessage(applyFile(db, V36))).toMatch(/run v31\/v32 first/);
    expect(await hasIdOneCheck(db)).toBe(true);
    expect(await fullUniqueCount(db)).toBe(0);
    await db.exec("ALTER TABLE lab_profile ALTER COLUMN department_id SET NOT NULL");
    await applyFile(db, V36);
    expect(await fullUniqueCount(db)).toBe(1);
    await db.close();
  }, 60_000);

  it("8. an existing PARTIAL unique index on department_id is not counted: v36 still adds the full unique", async () => {
    const db = await baseDb();
    await db.exec("CREATE UNIQUE INDEX lab_profile_partial_uq ON lab_profile (department_id) WHERE id > 5");
    expect(await fullUniqueCount(db)).toBe(0);
    await applyFile(db, V36);
    expect(await fullUniqueCount(db)).toBe(1);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(true);
    await db.close();
  }, 60_000);

  it("9. an existing full unique under another name: forward adds no second one, rollback does not drop it", async () => {
    const db = await baseDb();
    await db.exec("ALTER TABLE lab_profile ADD CONSTRAINT other_name_uq UNIQUE (department_id)");
    await applyFile(db, V36);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(false);
    expect(await fullUniqueCount(db)).toBe(1);
    await applyFile(db, V36_RB);
    expect(await constraintExists(db, "other_name_uq")).toBe(true);
    expect(await fullUniqueCount(db)).toBe(1);
    expect(await hasIdOneCheck(db)).toBe(true);
    await db.close();
  }, 60_000);

  it("10. another CHECK that covers only column id (not id = 1) makes forward throw and change nothing", async () => {
    const db = await baseDb();
    await db.exec("ALTER TABLE lab_profile ADD CONSTRAINT lab_profile_id_positive CHECK (id > 0)");
    expect(await raisedMessage(applyFile(db, V36))).toMatch(/unexpected CHECK lab_profile_id_positive/);
    expect(await hasIdOneCheck(db)).toBe(true);
    expect(await constraintExists(db, "lab_profile_id_positive")).toBe(true);
    expect(await fullUniqueCount(db)).toBe(0);
    await db.close();
  }, 60_000);

  it("11. rollback refuses when a row with id <> 1 exists, and changes nothing", async () => {
    const db = await baseDb();
    await applyFile(db, V36);
    await db.query("INSERT INTO lab_profile (id, department_id) VALUES (2, 2)");
    expect(await raisedMessage(applyFile(db, V36_RB))).toMatch(/^rollback refused/);
    expect(await scalar(db, "SELECT count(*)::int AS v FROM lab_profile")).toBe(2);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(true);
    expect(await hasIdOneCheck(db)).toBe(false);
    await db.close();
  }, 60_000);

  it("12. rollback (run twice) restores the CHECK, drops our unique and leaves row id 1 untouched", async () => {
    const db = await baseDb();
    const rowBefore = await idOneRow(db);
    await applyFile(db, V36);
    await applyFile(db, V36_RB);
    await applyFile(db, V36_RB);
    expect(await hasIdOneCheck(db)).toBe(true);
    expect(await constraintExists(db, "lab_profile_department_id_key")).toBe(false);
    expect((await checkDefs(db)).filter((c) => /^CHECK \(+id = 1\)+$/.test(c.def))).toHaveLength(1);
    await expect(db.query("INSERT INTO lab_profile (id, department_id) VALUES (2, 2)")).rejects.toMatchObject({ code: "23514" });
    expect(await idOneRow(db)).toEqual(rowBefore);
    await db.close();
  }, 60_000);

  it("13. full cycle: v36 rollback then v35..v30 rollbacks, then forward again, ends with identical counts", async () => {
    const db = await newDb();
    await applyAll(db, [...FORWARD, V36]);
    const first = await counts(db);
    await applyAll(db, [V36_RB, ...ROLLBACK]);
    await applyAll(db, [...FORWARD, V36]);
    expect(await counts(db)).toEqual(first);
    expect(await hasIdOneCheck(db)).toBe(false);
    expect(await fullUniqueCount(db)).toBe(1);
    await db.close();
  }, 120_000);

  it("14. v36 rollback still works after the v31 rollback already dropped department_id (and when the table is gone)", async () => {
    const db = await baseDb();
    await applyFile(db, V36);
    await applyAll(db, ROLLBACK.slice(0, 5)); // v35 .. v31
    expect(await columnExists(db, "lab_profile", "department_id")).toBe(false);
    await applyFile(db, V36_RB);
    expect(await hasIdOneCheck(db)).toBe(true);
    await applyFile(db, V36_RB);
    await db.exec("DROP TABLE lab_profile");
    await applyFile(db, V36_RB); // table missing: finishes quietly
    await db.close();
  }, 60_000);

  it("15. static: neither file writes lab_profile rows (INSERT/UPDATE/DELETE/TRUNCATE, comments excluded) or uses uppercase LAB", () => {
    for (const file of [V36, V36_RB]) {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      const code = text.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
      expect(code, file).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      expect(text, file).not.toMatch(/LAB/);
      expect(text, file).toMatch(/^SET lock_timeout = '3s';$/m);
    }
  });
});
