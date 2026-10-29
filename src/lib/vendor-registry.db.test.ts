import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Approved companies across usable rooms, against a real (in-memory) Postgres with its own database.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({ target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) }));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});

import { findApprovedVendor, listApprovedVendorNames } from "./vendor-registry";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
const DEPT_C = 3;

const exec = (text: string) => db.db.exec(text);

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  // This file owns its database, so it may allow one company name in several rooms.
  await exec("ALTER TABLE vendors DROP CONSTRAINT vendors_name_key");
  await exec(`INSERT INTO departments (id, code, name, is_active) VALUES (${DEPT_C}, 'RC', 'Room C', true)`);
}, 120_000);

afterAll(async () => {
  delete process.env.DEPARTMENTS_ENABLED;
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  // Baseline: only the seeded vendors ('Vendor A' in room 1, 'MB Vendor' in room 2); rooms 1 'CC', 2 'MB', 3 'RC' active.
  await exec(`
    DELETE FROM vendors WHERE name NOT IN ('Vendor A', 'MB Vendor');
    UPDATE vendors SET is_approved = TRUE;
    UPDATE departments SET is_active = true;
    UPDATE departments SET code = 'Z-TMP-' || id;
    UPDATE departments SET code = 'CC' WHERE id = ${DEPT_A};
    UPDATE departments SET code = 'MB' WHERE id = ${DEPT_B};
    UPDATE departments SET code = 'RC' WHERE id = ${DEPT_C};
  `);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const addVendor = (name: string, dept: number, approved = true) =>
  db.db.query("INSERT INTO vendors (name, department_id, is_approved) VALUES ($1, $2, $3)", [name, dept, approved]);

describe("listApprovedVendorNames", () => {
  it("flag on: a vendor only in room B is listed", async () => {
    const names = await listApprovedVendorNames();
    expect(names).toContain("MB Vendor");
    expect(names).toContain("Vendor A");
  });

  it("a vendor in an inactive room is not listed and not found", async () => {
    await exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    expect(await listApprovedVendorNames()).not.toContain("MB Vendor");
    expect(await findApprovedVendor("MB Vendor")).toBeNull();
  });

  it("a vendor in a room without a code is not listed and not found", async () => {
    await exec(`UPDATE departments SET code = NULL WHERE id = ${DEPT_B}`);
    expect(await listApprovedVendorNames()).not.toContain("MB Vendor");
    expect(await findApprovedVendor("MB Vendor")).toBeNull();
  });

  it("is_approved = false is never listed or found", async () => {
    await addVendor("Pending Co", DEPT_B, false);
    expect(await listApprovedVendorNames()).not.toContain("Pending Co");
    expect(await findApprovedVendor("Pending Co")).toBeNull();
  });

  it("the same exact name in two rooms is listed once", async () => {
    await addVendor("Twin Co", DEPT_A);
    await addVendor("Twin Co", DEPT_B);
    expect((await listApprovedVendorNames()).filter((n) => n === "Twin Co")).toEqual(["Twin Co"]);
  });

  it("names differing only by case in two rooms are both listed", async () => {
    await addVendor("Case Co", DEPT_A);
    await addVendor("CASE CO", DEPT_B);
    const names = await listApprovedVendorNames();
    expect(names).toContain("Case Co");
    expect(names).toContain("CASE CO");
  });

  it("is ordered by name ascending", async () => {
    await addVendor("Aaa Co", DEPT_B);
    const names = await listApprovedVendorNames();
    const expected = (await db.db.query<{ name: string }>("SELECT DISTINCT name FROM vendors ORDER BY name ASC")).rows.map((r) => r.name);
    expect(names).toEqual(expected);
    expect(names[0]).toBe("Aaa Co");
  });
});

describe("findApprovedVendor", () => {
  it("the exact spelling picked wins over a lower room id", async () => {
    await addVendor("Pick Co", DEPT_A);
    await addVendor("PICK CO", DEPT_B);
    expect(await findApprovedVendor("PICK CO")).toEqual({ name: "PICK CO", departmentId: DEPT_B });
    expect(await findApprovedVendor("Pick Co")).toEqual({ name: "Pick Co", departmentId: DEPT_A });
  });

  it("findApprovedVendor returns the matched row's department id", async () => {
    expect(await findApprovedVendor("mb vendor")).toEqual({ name: "MB Vendor", departmentId: DEPT_B });
  });

  it("findApprovedVendor prefers the room coded CC even when it is not the lowest id", async () => {
    await exec(`UPDATE departments SET code = 'Z1' WHERE id = ${DEPT_A}; UPDATE departments SET code = 'CC' WHERE id = ${DEPT_B}`);
    await addVendor("Pref Co", DEPT_A);
    await addVendor("PREF CO", DEPT_B);
    expect(await findApprovedVendor("pref co")).toEqual({ name: "PREF CO", departmentId: DEPT_B });
  });

  it("findApprovedVendor without any CC room falls back to the lowest room id", async () => {
    await exec(`UPDATE departments SET code = 'Z1' WHERE id = ${DEPT_A}`);
    await addVendor("Low Co", DEPT_C);
    await addVendor("LOW CO", DEPT_B);
    expect(await findApprovedVendor("low co")).toEqual({ name: "LOW CO", departmentId: DEPT_B });
  });

  it("two spellings in the same room that differ only by case tie-break by v.id", async () => {
    await addVendor("Tie Co", DEPT_B);
    await addVendor("TIE CO", DEPT_B);
    expect(await findApprovedVendor("tie co")).toEqual({ name: "Tie Co", departmentId: DEPT_B });
  });
});
