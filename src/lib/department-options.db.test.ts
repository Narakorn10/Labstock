import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// listUserDepartments (switcher options) against the real production schema + v30-v34 on PGlite.
// The rule set must match validateDepartmentSwitch exactly, so the property test compares every user x department.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
}));

vi.mock("./db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values),
}));

import { listUserDepartments, validateDepartmentSwitch } from "./department-switch";

const DEPT_CLOSED = 3; // is_active = false, code 'X3'
const DEPT_NO_CODE = 4; // active, code NULL
const ALL_DEPARTMENTS = [DEPT_A, DEPT_B, DEPT_CLOSED, DEPT_NO_CODE, 999];

const USERS = ["admin1", "user1", "solo1", "solo2", "vendor1", "newbie", "ghost", "susp1", "suspadmin", "vendor2", "admin2"];

const NAME_A = "ห้องปฏิบัติการเคมีคลินิก";
const NAME_B = "งานอณูชีววิทยา";
const NAME_NO_CODE = "งานที่ยังไม่มีรหัส";

let db: PgliteSql;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  // Extra cases live in this file only (department-fixtures.ts is shared and must not change).
  await db.db.exec(`
    INSERT INTO departments (id, name, code, is_active) VALUES
      (${DEPT_CLOSED}, 'งานที่ปิดแล้ว', 'X3', false),
      (${DEPT_NO_CODE}, '${NAME_NO_CODE}', NULL, true);

    INSERT INTO users (username, password_hash, name, role, vendor, account_status) VALUES
      ('susp1', 'x', 'Suspended User', 'User', '', 'suspended'),
      ('suspadmin', 'x', 'Suspended Admin', 'Admin', '', 'suspended'),
      ('vendor2', 'x', 'Vendor Two', 'Vendor', 'Vendor B', 'active'),
      ('admin2', 'x', 'Admin Two', 'Admin', '', 'active');

    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('user1', ${DEPT_CLOSED}, NULL, false),
      ('user1', ${DEPT_NO_CODE}, NULL, false),
      ('solo1', ${DEPT_NO_CODE}, NULL, false),
      ('susp1', ${DEPT_A}, NULL, true),
      ('vendor1', ${DEPT_B}, NULL, false),
      ('vendor2', ${DEPT_A}, NULL, true),
      ('admin2', ${DEPT_A}, NULL, true);
  `);
  h.target = db as unknown as Impl;
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

describe("listUserDepartments", () => {
  it("returns every active department the member belongs to, with switchable = has a code, ordered by id", async () => {
    expect(await listUserDepartments("user1")).toEqual([
      { id: DEPT_A, name: NAME_A, code: "CC", switchable: true },
      { id: DEPT_B, name: NAME_B, code: "MB", switchable: true },
      { id: DEPT_NO_CODE, name: NAME_NO_CODE, code: null, switchable: false },
    ]);
  });

  it("closed departments never appear, even for members", async () => {
    const ids = (await listUserDepartments("user1")).map((row) => row.id);
    expect(ids).not.toContain(DEPT_CLOSED);
  });

  it("single-department member: one row (a code-less department is listed but not switchable)", async () => {
    expect(await listUserDepartments("solo1")).toEqual([
      { id: DEPT_A, name: NAME_A, code: "CC", switchable: true },
      { id: DEPT_NO_CODE, name: NAME_NO_CODE, code: null, switchable: false },
    ]);
    expect(await listUserDepartments("solo2")).toEqual([
      { id: DEPT_B, name: NAME_B, code: "MB", switchable: true },
    ]);
  });

  it("global Admin sees every active department (membership not required), closed one excluded", async () => {
    const expected = [
      { id: DEPT_A, name: NAME_A, code: "CC", switchable: true },
      { id: DEPT_B, name: NAME_B, code: "MB", switchable: true },
      { id: DEPT_NO_CODE, name: NAME_NO_CODE, code: null, switchable: false },
    ];
    expect(await listUserDepartments("admin1")).toEqual(expected);
    expect(await listUserDepartments("admin2")).toEqual(expected);
  });

  it("Vendor gets [] even with memberships", async () => {
    expect(await listUserDepartments("vendor1")).toEqual([]);
    expect(await listUserDepartments("vendor2")).toEqual([]);
  });

  it("account_status other than active gets [] (including an Admin); unknown user and no membership get []", async () => {
    expect(await listUserDepartments("susp1")).toEqual([]);
    expect(await listUserDepartments("suspadmin")).toEqual([]);
    expect(await listUserDepartments("ghost")).toEqual([]);
    expect(await listUserDepartments("newbie")).toEqual([]);
    expect(await listUserDepartments("")).toEqual([]);
  });

  it("a department deactivated later disappears from the list", async () => {
    await db.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    try {
      expect((await listUserDepartments("user1")).map((row) => row.id)).toEqual([DEPT_A, DEPT_NO_CODE]);
      expect(await listUserDepartments("solo2")).toEqual([]);
    } finally {
      await db.db.exec(`UPDATE departments SET is_active = true WHERE id = ${DEPT_B}`);
    }
  });

  it("treats the username as a bound parameter, not SQL", async () => {
    expect(await listUserDepartments("user1' OR '1'='1")).toEqual([]);
  });
});

describe("listUserDepartments vs validateDepartmentSwitch (property: every user x department)", () => {
  it("a department is switchable in the list exactly when validateDepartmentSwitch accepts it", async () => {
    let checked = 0;
    for (const username of USERS) {
      const rows = await listUserDepartments(username);
      for (const id of ALL_DEPARTMENTS) {
        const target = await validateDepartmentSwitch(username, id);
        const row = rows.find((candidate) => candidate.id === id);
        const expectedSwitchable = row?.switchable === true;
        expect(target !== null, `${username} -> ${id}`).toBe(expectedSwitchable);
        if (target) expect(target.department.code, `${username} -> ${id}`).toBe(row?.code);
        checked++;
      }
    }
    expect(checked).toBe(USERS.length * ALL_DEPARTMENTS.length);
  });

  it("a department not in the list, or listed with switchable=false, is always refused", async () => {
    for (const username of USERS) {
      const rows = await listUserDepartments(username);
      for (const row of rows.filter((candidate) => !candidate.switchable)) {
        expect(await validateDepartmentSwitch(username, row.id), `${username} -> ${row.id}`).toBeNull();
      }
      for (const id of ALL_DEPARTMENTS.filter((candidate) => !rows.some((row) => row.id === candidate))) {
        expect(await validateDepartmentSwitch(username, id), `${username} -> ${id}`).toBeNull();
      }
    }
  });

  it("the list never contains ALL: ALL stays a separate Admin-only target", async () => {
    for (const username of USERS) {
      const rows = await listUserDepartments(username);
      expect(rows.every((row) => typeof row.id === "number")).toBe(true);
      expect((await validateDepartmentSwitch(username, "ALL")) !== null).toBe(username === "admin1" || username === "admin2");
    }
  });
});
