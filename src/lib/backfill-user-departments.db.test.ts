import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";
import { backfillUserDepartments } from "../../scripts/backfill-user-departments-lib.mjs";

// The one-off backfill before the first DEPARTMENTS_ENABLED=true. Real (in-memory) Postgres, production schema + v30-v35.
// seedTwoDepartments: 'newbie' has no membership; every other user has one.

let db: PgliteSql;

const query = async (text: string, params: unknown[] = []) => (await db.db.query(text, params)).rows as Array<Record<string, unknown>>;
const rooms = async (username: string) =>
  (await db.db.query<{ department_id: number; role: string | null; is_default: boolean }>(
    "SELECT department_id, role, is_default FROM user_departments WHERE username = $1 ORDER BY department_id", [username])).rows;
const total = async () => Number((await db.db.query<{ n: string }>("SELECT count(*) AS n FROM user_departments")).rows[0].n);

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  await db.db.exec(`
    DELETE FROM user_departments WHERE username LIKE 'late%' OR username = 'newbie';
    DELETE FROM users WHERE username LIKE 'late%';
    INSERT INTO users (username, password_hash, name, role, account_status) VALUES
      ('lateA', 'x', 'Late A', 'User', 'active'), ('latePend', 'x', 'Late pending', 'User', 'pending'),
      ('lateVend', 'x', 'Late vendor', 'Vendor', 'pending');
  `);
});

describe("backfillUserDepartments", () => {
  it("report mode lists who has no membership and writes nothing", async () => {
    const before = await total();
    const result = await backfillUserDepartments(query, { apply: false });
    expect(result.applied).toBe(false);
    expect(result.missing).toEqual(["lateA", "latePend", "lateVend", "newbie"]);
    expect(result.added).toEqual([]);
    expect(result.defaultRoomId).toBe(DEPT_A);
    expect(await total()).toBe(before);
  });

  it("apply adds exactly those users to the default room as their default room, with no role override", async () => {
    const before = await total();
    const result = await backfillUserDepartments(query, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.added).toEqual(["lateA", "latePend", "lateVend", "newbie"]);
    expect(result.before).toBe(before);
    expect(result.after).toBe(before + 4);
    for (const username of result.added) expect(await rooms(username), username).toEqual([{ department_id: DEPT_A, role: null, is_default: true }]);
  });

  it("does not touch anyone who already has a room, including a default room that is not CC", async () => {
    const snapshot = JSON.stringify(await query("SELECT username, department_id, role, is_default FROM user_departments WHERE username IN ('solo1', 'solo2', 'user1') ORDER BY 1, 2"));
    await backfillUserDepartments(query, { apply: true });
    expect(JSON.stringify(await query("SELECT username, department_id, role, is_default FROM user_departments WHERE username IN ('solo1', 'solo2', 'user1') ORDER BY 1, 2"))).toBe(snapshot);
    expect((await rooms("solo2")).map((r) => r.department_id)).toEqual([DEPT_B]);
  });

  it("is safe to run twice: the second run adds nobody", async () => {
    await backfillUserDepartments(query, { apply: true });
    const again = await backfillUserDepartments(query, { apply: true });
    expect(again.missing).toEqual([]);
    expect(again.added).toEqual([]);
    expect(again.after).toBe(again.before);
  });

  it("rolls back everything when a check fails (a pre-existing double default is detected)", async () => {
    // Break the one-default rule on purpose to prove the transaction guard: drop the index, add a second default.
    await db.db.exec("DROP INDEX user_departments_one_default_idx");
    await db.db.exec(`INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('solo1', ${DEPT_B}, NULL, true)`);
    const before = await total();
    try {
      await expect(backfillUserDepartments(query, { apply: true })).rejects.toThrow(/two default rooms/);
      expect(await total()).toBe(before);
      expect(await rooms("lateA")).toEqual([]);
    } finally {
      await db.db.exec(`DELETE FROM user_departments WHERE username = 'solo1' AND department_id = ${DEPT_B}`);
      await db.db.exec("CREATE UNIQUE INDEX user_departments_one_default_idx ON user_departments (username) WHERE is_default");
    }
  });

  it("refuses when there is no active default room 'CC'", async () => {
    await db.db.exec("UPDATE departments SET is_active = false WHERE code = 'CC'");
    try {
      await expect(backfillUserDepartments(query, { apply: true })).rejects.toThrow(/default room/);
      expect(await rooms("lateA")).toEqual([]);
    } finally {
      await db.db.exec("UPDATE departments SET is_active = true WHERE code = 'CC'");
    }
  });
});
