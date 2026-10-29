import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Self-registration against a real (in-memory) Postgres: flag OFF keeps the legacy insert, flag ON also writes the room.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({ target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) }));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});

import { GET, POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let migrated: PgliteSql;
let legacy: PgliteSql;

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/auth/register", { method: "POST", body: JSON.stringify(body) }));

let n = 0;
const lab = (extra: Record<string, unknown> = {}) => {
  n += 1;
  return { name: "New Person", email: `new${n}@example.com`, username: `newuser${n}`, password: "a-long-password-123", accountType: "lab", ...extra };
};

const memberships = async (username: string) =>
  (await migrated.db.query("SELECT department_id, role, is_default FROM user_departments WHERE username = $1", [username])).rows;
const userCount = async (db: PgliteSql, username: string) =>
  Number((await db.db.query<{ c: string }>("SELECT count(*) AS c FROM users WHERE username = $1", [username])).rows[0].c);

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  legacy = createPgliteSql(new PGlite());
  await applyProdSchema(legacy.db);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
  await legacy.db.close();
});

beforeEach(async () => {
  h.target = migrated as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await migrated.db.exec(`UPDATE departments SET is_active = true; UPDATE departments SET code = 'MB' WHERE id = ${DEPT_B}`);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flag OFF: unchanged", () => {
  it("creates the pending user only, with no room (also on a database without user_departments)", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    for (const db of [migrated, legacy]) {
      h.target = db as unknown as Impl;
      const body = lab();
      const response = await post(body);
      expect(response.status).toBe(201);
      expect(await userCount(db, body.username)).toBe(1);
    }
    expect(await memberships("newuser1")).toEqual([]);
  });

  it("GET gives no rooms", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const data = await (await GET()).json();
    expect(data.departments).toEqual([]);
  });
});

describe("vendors of ALL usable rooms (owner decision): sign-up lists them and places the account in the company's room", () => {
  // 'MB Vendor' exists only in department B (see department-fixtures.ts).
  const vendorOf = async (username: string) =>
    (await migrated.db.query<{ vendor: string }>("SELECT vendor FROM users WHERE username = $1", [username])).rows[0].vendor;

  for (const flag of ["on", "off"]) {
    it(`flag ${flag}: GET lists a vendor that exists only in department B`, async () => {
      if (flag === "off") delete process.env.DEPARTMENTS_ENABLED;
      const data = await (await GET()).json();
      expect(data.vendors).toContain("MB Vendor");
      expect(data.vendors).toContain("Vendor A");
    });

    it(`flag ${flag}: POST vendorMode existing accepts a vendor that exists only in department B`, async () => {
      if (flag === "off") delete process.env.DEPARTMENTS_ENABLED;
      const body = lab({ accountType: "vendor", vendorMode: "existing", vendorName: "mb vendor" });
      const response = await post(body);
      expect(response.status).toBe(201);
      expect(await vendorOf(body.username)).toBe("MB Vendor");
    });
  }

  it("flag on: a vendor only in room B signs up; the account and its membership are in room B and users.vendor is the exact stored name", async () => {
    const body = lab({ accountType: "vendor", vendorMode: "existing", vendorName: "mb vendor" });
    expect((await post(body)).status).toBe(201);
    expect(await memberships(body.username)).toEqual([{ department_id: DEPT_B, role: null, is_default: true }]);
    expect(await vendorOf(body.username)).toBe("MB Vendor");
  });

  it("flag on: a vendor that exists in CC signs up into CC", async () => {
    const body = lab({ accountType: "vendor", vendorMode: "existing", vendorName: "Vendor A" });
    expect((await post(body)).status).toBe(201);
    expect(await memberships(body.username)).toEqual([{ department_id: DEPT_A, role: null, is_default: true }]);
  });

  it("flag on: a vendor only in an inactive room cannot sign up (400) and nothing is created", async () => {
    await migrated.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    const body = lab({ accountType: "vendor", vendorMode: "existing", vendorName: "MB Vendor" });
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await userCount(migrated, body.username)).toBe(0);
    expect(await memberships(body.username)).toEqual([]);
    const listed = await (await GET()).json();
    expect(listed.vendors).not.toContain("MB Vendor");
  });
});

describe("flag OFF: recorded SQL", () => {
  it("GET and POST (lab, vendor existing, vendor request) never mention department_id, user_departments or departments", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const seen: string[] = [];
    for (const db of [migrated, legacy]) {
      h.target = Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const query = db(strings, ...values);
          seen.push(query.text);
          return query;
        },
        { unsafe: (text: string) => db.unsafe(text), transaction: (queries: never) => db.transaction(queries) },
      ) as unknown as Impl;
      expect((await GET()).status).toBe(200);
      expect((await post(lab())).status).toBe(201);
      expect((await post(lab({ accountType: "vendor", vendorMode: "existing", vendorName: "Vendor A" }))).status).toBe(201);
      expect((await post(lab({ accountType: "vendor", vendorMode: "request", vendorRequest: "Some Vendor Co" }))).status).toBe(201);
    }
    expect(seen.length).toBeGreaterThan(12);
    expect(seen.filter((text) => /department_id|user_departments|departments/i.test(text))).toEqual([]);
  });
});

describe("flag ON", () => {
  it("GET lists active rooms that have a code", async () => {
    await migrated.db.exec(`INSERT INTO departments (name) VALUES ('No code room'); UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    const data = await (await GET()).json();
    expect(data.departments).toEqual([{ id: DEPT_A, name: "ห้องปฏิบัติการเคมีคลินิก" }]);
    await migrated.db.exec("DELETE FROM departments WHERE name = 'No code room'");
  });

  it("a lab account picks a room: user (pending) and membership are created together, as the default room", async () => {
    const body = lab({ departmentId: DEPT_B });
    const response = await post(body);
    expect(response.status).toBe(201);
    expect(await memberships(body.username)).toEqual([{ department_id: DEPT_B, role: null, is_default: true }]);
    const status = (await migrated.db.query<{ account_status: string }>("SELECT account_status FROM users WHERE username = $1", [body.username])).rows[0].account_status;
    expect(status).toBe("pending");
  });

  it("accepts the room id as a numeric string", async () => {
    const body = lab({ departmentId: String(DEPT_A) });
    expect((await post(body)).status).toBe(201);
    expect((await memberships(body.username)).map((row) => (row as { department_id: number }).department_id)).toEqual([DEPT_A]);
  });

  it("a lab account without a room, with a bad room, an inactive room or a room without a code creates nothing", async () => {
    await migrated.db.exec("INSERT INTO departments (name) VALUES ('No code room')");
    const noCodeId = Number((await migrated.db.query<{ id: number }>("SELECT id FROM departments WHERE name = 'No code room'")).rows[0].id);
    await migrated.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_B}`);
    for (const departmentId of [undefined, "abc", 0, -1, 99999, DEPT_B, noCodeId, 1.5]) {
      const body = lab({ departmentId });
      const response = await post(body);
      expect(response.status, String(departmentId)).toBe(400);
      expect(await userCount(migrated, body.username), String(departmentId)).toBe(0);
    }
    await migrated.db.exec("DELETE FROM departments WHERE name = 'No code room'");
  });

  it("flag on: request-mode vendor goes to the default room CC and ignores any room it sends", async () => {
    await migrated.db.exec("UPDATE vendors SET is_approved = TRUE");
    const body = lab({ accountType: "vendor", vendorMode: "request", vendorRequest: "Some Vendor Co", departmentId: DEPT_B });
    expect((await post(body)).status).toBe(201);
    expect(await memberships(body.username)).toEqual([{ department_id: DEPT_A, role: null, is_default: true }]);
  });

  it("a duplicate username or email still answers 409 and writes no membership", async () => {
    const body = lab({ departmentId: DEPT_A });
    expect((await post(body)).status).toBe(201);
    const again = await post({ ...body, email: "other@example.com" });
    expect(again.status).toBe(409);
    expect((await memberships(body.username)).length).toBe(1);
  });
});
