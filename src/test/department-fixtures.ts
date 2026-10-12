import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { expect } from "vitest";
import { PROD_SCHEMA_DDL, PROD_SEED_SQL } from "@/test/pglite-prod-schema";
import type { PgliteSql } from "@/test/pglite-sql";
import { splitSqlStatements } from "../../scripts/sql-statements.mjs";

// Shared fixtures for department (multi-lab) tests. They run on an in-memory PGlite that mirrors the real production
// schema (PROD_SCHEMA_DDL) and apply upgrade_v30..v34 the same way src/lib/department-migrations.db.test.ts does:
// statement by statement with the production splitter, with only the keyword CONCURRENTLY removed (PGlite cannot run
// CREATE INDEX CONCURRENTLY). The helpers below are intentionally the same as that test's private ones.

export const DEPARTMENT_MIGRATIONS = [
  "upgrade_v30_departments_core.sql",
  "upgrade_v31_department_columns.sql",
  "upgrade_v32_department_constraints.sql",
  "upgrade_v33_item_code.sql",
  "upgrade_v34_indexes.sql",
];

export const DEPT_A = 1; // CC, the default department that owns all pre-existing data
export const DEPT_B = 2; // arbitrary second department, code 'MB'

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

/** Production schema + the small production-like seed (departments 1 and 2, admin1/user1/vendor1, a few items). No v30-v34. */
export async function applyProdSchema(db: PGlite) {
  await db.exec(PROD_SCHEMA_DDL);
  await db.exec(PROD_SEED_SQL);
}

export async function applyDepartmentMigrations(db: PGlite) {
  for (const file of DEPARTMENT_MIGRATIONS) await applyFile(db, file);
}

/**
 * Builds the full two-department world on an EMPTY pglite database: production schema, v30-v34, then:
 *   dept 1 = CC (id 1), dept 2 = MB (id 2)
 *   (the v30 backfill leaves user_departments.role NULL = use users.role; explicit overrides are set below)
 *   admin1   global Admin   member of dept 1 (backfill, role NULL)
 *   user1    global User    dept 1 role NULL (default), dept 2 explicit override Operator
 *   solo1    global User    dept 1 only (role NULL)
 *   solo2    global User    dept 2 only (explicit override Technician)
 *   vendor1  global Vendor  dept 1 only (role NULL), vendor 'Vendor A'
 *   newbie   global User    NO membership row (created after the v30 backfill): department-aware auth REJECTS this user
 * and master_data / vendors / logs rows for each department (dept 1 rows come from the seed + extras).
 */
export async function seedTwoDepartments(sql: PgliteSql) {
  const db = sql.db;
  await applyProdSchema(db);
  await applyDepartmentMigrations(db);

  await db.exec(`
    UPDATE departments SET code = 'MB' WHERE id = ${DEPT_B};

    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('solo1', 'x', 'Solo One', 'User', ''),
      ('solo2', 'x', 'Solo Two', 'User', ''),
      ('newbie', 'x', 'No Membership', 'User', '');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('solo1', ${DEPT_A}, NULL, true),
      ('solo2', ${DEPT_B}, 'Technician', true),
      ('user1', ${DEPT_B}, 'Operator', false);

    INSERT INTO master_data (item_id, name, unit, vendor, department_id) VALUES
      ('A-000002', 'Dept A extra item', 'box', 'Vendor A', ${DEPT_A}),
      ('MB-000001', 'Dept B item 1', 'box', 'MB Vendor', ${DEPT_B}),
      ('MB-000002', 'Dept B item 2', 'kit', 'MB Vendor', ${DEPT_B});
    INSERT INTO vendors (name, department_id) VALUES ('MB Vendor', ${DEPT_B});
    INSERT INTO logs (item_id, name, action, quantity, username, department_id) VALUES
      ('LAB-000001', 'Reagent 1', 'RECEIVE', 1, 'user1', ${DEPT_A}),
      ('A-000002', 'Dept A extra item', 'DISPENSE', 1, 'solo1', ${DEPT_A}),
      ('MB-000001', 'Dept B item 1', 'RECEIVE', 5, 'solo2', ${DEPT_B}),
      ('MB-000002', 'Dept B item 2', 'DISPENSE', 2, 'user1', ${DEPT_B});
  `);

  return { deptA: DEPT_A, deptB: DEPT_B };
}

/** Asserts rows is non-empty and every row belongs to the given department. */
export function expectOnlyDepartment(rows: Array<Record<string, unknown>>, id: number) {
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map((row) => row.department_id)).toEqual(rows.map(() => id));
}
