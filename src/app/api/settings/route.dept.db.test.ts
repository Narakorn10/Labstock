import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Settings lists (categories, units, vendors) per room against a real (in-memory) Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));

import { GET, POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const get = async () => (await (await GET(new Request("http://localhost/api/settings")))!.json()) as Record<string, string[]>;
const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) }));
const room = async (table: string, name: string) =>
  (await db.db.query<{ department_id: number }>(`SELECT department_id FROM ${table} WHERE name = $1`, [name])).rows[0]?.department_id;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    UPDATE master_data SET reagent_type = NULL, job_type = NULL, machine_type = NULL, unit = NULL, vendor = NULL;
    DELETE FROM reagent_types; DELETE FROM job_types; DELETE FROM machine_types;
    INSERT INTO reagent_types (name, department_id) VALUES ('RT-A', ${DEPT_A}), ('RT-B', ${DEPT_B}), ('RT-shared', ${DEPT_A});
    INSERT INTO job_types (name, department_id) VALUES ('JT-A', ${DEPT_A}), ('JT-B', ${DEPT_B});
    INSERT INTO machine_types (name, department_id) VALUES ('MT-A', ${DEPT_A}), ('MT-B', ${DEPT_B});
    UPDATE master_data SET unit = 'unit-A', vendor = 'Vendor A' WHERE item_id = 'A-000002';
    UPDATE master_data SET unit = 'unit-B', vendor = 'Vendor B', reagent_type = 'RT-shared' WHERE item_id = 'MB-000001';
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("GET lists everything", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("user1", "User", null);
    const data = await get();
    expect(data.reagentTypes).toEqual(["RT-A", "RT-B", "RT-shared"]);
    expect(data.units).toEqual(["unit-A", "unit-B"]);
  });

  it("POST add / delete behave as before (any category, no room)", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("admin1", "Admin", null);
    expect((await post({ action: "add", type: "job", value: "JT-legacy" }))!.status).toBe(200);
    expect((await post({ action: "delete", type: "job", value: "JT-legacy" }))!.status).toBe(200);
  });
});

describe("GET with a room", () => {
  it("room B gets its own categories, plus the shared name its item uses, but not room A's", async () => {
    as("solo2", "User", DEPT_B);
    const data = await get();
    expect(data.reagentTypes).toEqual(["RT-B", "RT-shared"]);
    expect(data.jobTypes).toEqual(["JT-B"]);
    expect(data.machineTypes).toEqual(["MT-B"]);
    expect(data.units).toEqual(["unit-B"]);
    expect(data.vendors).toEqual(["Vendor B"]);
  });

  it("room A does not see room B's categories, units or vendors", async () => {
    as("solo1", "User", DEPT_A);
    const data = await get();
    expect(data.reagentTypes).toEqual(["RT-A", "RT-shared"]);
    expect(data.units).toEqual(["unit-A"]);
    expect(data.vendors).toEqual(["Vendor A"]);
  });

  it("Admin viewing ALL rooms sees everything; a Vendor sees only its own vendor in its room", async () => {
    as("admin1", "Admin", "ALL");
    expect((await get()).reagentTypes).toEqual(["RT-A", "RT-B", "RT-shared"]);
    as("mbvendor", "Vendor", DEPT_B, { vendor: "Vendor B" });
    expect((await get()).vendors).toEqual(["Vendor B"]);
  });
});

describe("POST with a room (Admin only)", () => {
  it("adds a category to the Admin's room", async () => {
    as("admin1", "Admin", DEPT_B);
    expect((await post({ action: "add", type: "machine", value: "MT-new" }))!.status).toBe(200);
    expect(await room("machine_types", "MT-new")).toBe(DEPT_B);
  });

  it("adding a name that exists in this room is fine; one that exists in ANOTHER room answers 409 and changes nothing", async () => {
    as("admin1", "Admin", DEPT_B);
    expect((await post({ action: "add", type: "reagent", value: "RT-B" }))!.status).toBe(200);
    const response = await post({ action: "add", type: "reagent", value: "RT-A" });
    expect(response!.status).toBe(409);
    expect(await room("reagent_types", "RT-A")).toBe(DEPT_A);
  });

  it("deletes only the Admin's own room's category; another room's name is left alone", async () => {
    as("admin1", "Admin", DEPT_B);
    expect((await post({ action: "delete", type: "job", value: "JT-A" }))!.status).toBe(200);
    expect(await room("job_types", "JT-A")).toBe(DEPT_A);
    expect((await post({ action: "delete", type: "job", value: "JT-B" }))!.status).toBe(200);
    expect(await room("job_types", "JT-B")).toBeUndefined();
  });

  it("deleting a category that an item still uses answers 409", async () => {
    await db.db.exec("UPDATE reagent_types SET department_id = " + DEPT_B + " WHERE name = 'RT-shared'");
    as("admin1", "Admin", DEPT_B);
    const response = await post({ action: "delete", type: "reagent", value: "RT-shared" });
    expect(response!.status).toBe(409);
    expect(await room("reagent_types", "RT-shared")).toBe(DEPT_B);
  });

  it("Admin viewing ALL rooms cannot change categories (409) but can still add and remove a department", async () => {
    as("admin1", "Admin", "ALL");
    const blocked = await post({ action: "add", type: "reagent", value: "RT-all" });
    expect(blocked!.status).toBe(409);
    expect((await blocked!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await room("reagent_types", "RT-all")).toBeUndefined();
    expect((await post({ action: "add", type: "department", value: "Temp room" }))!.status).toBe(200);
    expect((await post({ action: "delete", type: "department", value: "Temp room" }))!.status).toBe(200);
  });

  it("a non-Admin is refused", async () => {
    as("solo2", "User", DEPT_B);
    expect((await post({ action: "add", type: "reagent", value: "RT-x" }))!.status).toBe(403);
  });
});
