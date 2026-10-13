import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Master data create / update / import per room against a real (in-memory) Postgres with the production schema + v30-v35.
// item_id is still the GLOBAL primary key: a room must never overwrite an item that belongs to another room.

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

import { POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const ITEM_A = "A-000002"; // room A (CC), name "Dept A extra item"
const ITEM_B = "MB-000001"; // room B (MB)

const item = (itemId: string, extra: Record<string, unknown> = {}) => ({
  itemId, name: "New name", reagentType: "RT-x", jobType: "JT-x", machineType: "MT-x", unit: "box", minThreshold: 1, weeklyTarget: 2, vendor: "V", ...extra,
});
const post = (body: unknown) => POST(new Request("http://localhost/api/master", { method: "POST", body: JSON.stringify(body) }));
const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const row = async (itemId: string) =>
  (await db.db.query<{ name: string; department_id: number }>("SELECT name, department_id FROM master_data WHERE item_id = $1", [itemId])).rows[0];
const categoryRoom = async (table: string, name: string) =>
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
    UPDATE master_data SET reagent_type = NULL, job_type = NULL, machine_type = NULL WHERE item_id IN ('${ITEM_A}', '${ITEM_B}');
    DELETE FROM master_data WHERE item_id LIKE 'NEW-%' OR reagent_type LIKE 'RT-%';
    DELETE FROM reagent_types WHERE name LIKE 'RT-%'; DELETE FROM job_types WHERE name LIKE 'JT-%'; DELETE FROM machine_types WHERE name LIKE 'MT-%';
    UPDATE master_data SET name = 'Dept A extra item' WHERE item_id = '${ITEM_A}';
    UPDATE master_data SET name = 'Dept B item 1' WHERE item_id = '${ITEM_B}';
    UPDATE user_departments SET admin_slot = NULL;
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("a Manager can still update any item and the upsert overwrites by item_id", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("manager", "Manager", null);
    expect((await post({ action: "update", ...item(ITEM_B, { name: "Legacy edit" }) }))!.status).toBe(200);
    expect((await row(ITEM_B)).name).toBe("Legacy edit");
    const bulk = await post({ action: "bulk_add", items: [item(ITEM_A, { name: "Legacy upsert" })] });
    expect(bulk!.status).toBe(200);
    expect((await row(ITEM_A)).name).toBe("Legacy upsert");
  });
});

describe("flag ON, scope = room B", () => {
  beforeEach(() => as("manager", "Manager", DEPT_B));

  it("creates an item and new categories in room B", async () => {
    const response = await post({ action: "create", ...item("NEW-B1") });
    expect(response!.status).toBe(200);
    expect((await row("NEW-B1")).department_id).toBe(DEPT_B);
    expect(await categoryRoom("reagent_types", "RT-x")).toBe(DEPT_B);
    expect(await categoryRoom("job_types", "JT-x")).toBe(DEPT_B);
    expect(await categoryRoom("machine_types", "MT-x")).toBe(DEPT_B);
  });

  it("an item without an ID gets a generated ID in room B", async () => {
    const response = await post({ action: "create", ...item("") });
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect((await row(body.itemId)).department_id).toBe(DEPT_B);
    await db.db.exec(`DELETE FROM master_data WHERE item_id = '${body.itemId}'`);
  });

  it("cannot create an item whose ID is used by room A (400) and does not change it", async () => {
    const response = await post({ action: "create", ...item(ITEM_A, { name: "Hijack" }) });
    expect(response!.status).toBe(400);
    expect(await row(ITEM_A)).toEqual({ name: "Dept A extra item", department_id: DEPT_A });
  });

  it("updates its own item but an item of room A is 'not found' (404) and unchanged", async () => {
    expect((await post({ action: "update", ...item(ITEM_B, { name: "B edit" }) }))!.status).toBe(200);
    expect((await row(ITEM_B)).name).toBe("B edit");
    expect((await post({ action: "update", ...item(ITEM_A, { name: "Hijack" }) }))!.status).toBe(404);
    expect((await row(ITEM_A)).name).toBe("Dept A extra item");
  });

  it("import: new rows are created in room B and own rows are updated", async () => {
    const response = await post({ action: "bulk_add", items: [item("NEW-B2"), item(ITEM_B, { name: "B import" }), item("")] });
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect(body.generatedItemIds).toHaveLength(1);
    expect((await row("NEW-B2")).department_id).toBe(DEPT_B);
    expect((await row(ITEM_B)).name).toBe("B import");
    expect((await row(body.generatedItemIds[0])).department_id).toBe(DEPT_B);
    await db.db.exec(`DELETE FROM master_data WHERE item_id = '${body.generatedItemIds[0]}'`);
  });

  it("import with an ID that belongs to room A refuses the WHOLE file: nothing is written and the ID is named", async () => {
    const response = await post({ action: "bulk_add", items: [item("NEW-B3"), item(ITEM_A, { name: "Hijack" })] });
    expect(response!.status).toBe(400);
    expect((await response!.json()).message).toContain(ITEM_A);
    expect(await row("NEW-B3")).toBeUndefined();
    expect((await row(ITEM_A)).name).toBe("Dept A extra item");
  });

  it("a category name that room A already has is reused and stays in room A", async () => {
    await db.db.exec(`INSERT INTO reagent_types (name, department_id) VALUES ('RT-shared', ${DEPT_A})`);
    expect((await post({ action: "create", ...item("NEW-B4", { reagentType: "RT-shared" }) }))!.status).toBe(200);
    expect(await categoryRoom("reagent_types", "RT-shared")).toBe(DEPT_A);
    expect((await row("NEW-B4")).department_id).toBe(DEPT_B);
  });

  it("Admin viewing ALL rooms cannot write (409 read-only)", async () => {
    as("admin1", "Admin", "ALL");
    const response = await post({ action: "create", ...item("NEW-ALL") });
    expect(response!.status).toBe(409);
    expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect(await row("NEW-ALL")).toBeUndefined();
  });
});

describe("who may write", () => {
  it("a room admin of room B can create in room B only; an ordinary member is refused", async () => {
    await db.db.exec(`UPDATE user_departments SET admin_slot = 1 WHERE username = 'solo2' AND department_id = ${DEPT_B}`);
    as("solo2", "User", DEPT_B);
    expect((await post({ action: "create", ...item("NEW-B5") }))!.status).toBe(200);
    expect((await row("NEW-B5")).department_id).toBe(DEPT_B);
    expect((await post({ action: "update", ...item(ITEM_A, { name: "Hijack" }) }))!.status).toBe(404);

    as("solo1", "User", DEPT_A);
    expect((await post({ action: "create", ...item("NEW-A1") }))!.status).toBe(403);
    expect(await row("NEW-A1")).toBeUndefined();
  });

  it("a Vendor can still import items of its own vendor name into its room", async () => {
    as("mbvendor", "Vendor", DEPT_B, { vendor: "MB Vendor" });
    const response = await post({ action: "bulk_add", items: [item("NEW-B6", { vendor: "MB Vendor" }), item("NEW-B7", { vendor: "Someone else" })] });
    expect(response!.status).toBe(200);
    expect((await row("NEW-B6")).department_id).toBe(DEPT_B);
    expect(await row("NEW-B7")).toBeUndefined();
  });
});
