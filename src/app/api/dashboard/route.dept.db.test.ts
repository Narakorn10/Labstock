import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Dashboard (items + stock) per room against a real (in-memory) Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
  texts: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    h.texts.push(strings.join("?"));
    return (h.target as Impl)(strings, ...values);
  }) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));

import { GET } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;

const ids = (rows: Array<{ itemId: string }>) => rows.map((row) => row.itemId);
const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const load = async () => (await GET(new Request("http://localhost/api/dashboard")))!;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  await db.db.exec(`
    UPDATE master_data SET vendor = 'Shared Vendor' WHERE item_id IN ('A-000002', 'MB-000001');
    INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES
      ('MB-000001', 'LB1', 10, '2026-09-01', ${DEPT_B}),
      ('A-000002', 'LA1', 7, '2026-09-01', ${DEPT_A});
  `);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(() => {
  h.target = db as unknown as Impl;
  h.texts = [];
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("flag OFF (legacy): unchanged", () => {
  it("lists the items of every room and the SQL has no department column", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    as("user1", "User", null);
    const response = await load();
    expect(ids(await response.json())).toEqual(expect.arrayContaining(["A-000002", "MB-000001"]));
    expect(h.texts.some((text) => /department_id/.test(text))).toBe(false);
  });
});

describe("flag ON", () => {
  it("room B sees only room B items and only room B stock", async () => {
    as("solo2", "User", DEPT_B);
    const data = await (await load()).json() as Array<{ itemId: string; quantity: number; lots: Array<{ lotNo: string }> }>;
    expect(ids(data)).toEqual(expect.arrayContaining(["MB-000001"]));
    expect(ids(data)).not.toContain("A-000002");
    expect(ids(data).filter((id) => id.startsWith("LAB-"))).toEqual([]);
    const item = data.find((row) => row.itemId === "MB-000001")!;
    expect(item.quantity).toBe(10);
    expect(item.lots.map((lot) => lot.lotNo)).toEqual(["LB1"]);
  });

  it("room A does not see room B items", async () => {
    as("solo1", "User", DEPT_A);
    const data = await (await load()).json() as Array<{ itemId: string }>;
    expect(ids(data)).toContain("A-000002");
    expect(ids(data)).not.toContain("MB-000001");
  });

  it("a stray lot of another room never adds to this room's quantity", async () => {
    await db.db.exec(`INSERT INTO inventory (item_id, lot_no, quantity, received_on, department_id) VALUES ('MB-000001', 'STRAY', 99, '2026-09-02', ${DEPT_A})`);
    try {
      as("solo2", "User", DEPT_B);
      const item = (await (await load()).json() as Array<{ itemId: string; quantity: number }>).find((row) => row.itemId === "MB-000001")!;
      expect(item.quantity).toBe(10);
    } finally {
      await db.db.exec("DELETE FROM inventory WHERE lot_no = 'STRAY'");
    }
  });

  it("a Vendor sees only its own vendor's items in its room", async () => {
    as("mbvendor", "Vendor", DEPT_B, { vendor: "Shared Vendor" });
    const data = await (await load()).json() as Array<{ itemId: string }>;
    expect(ids(data)).toEqual(["MB-000001"]);
  });

  it("Admin viewing ALL rooms sees every item", async () => {
    as("admin1", "Admin", "ALL");
    expect(ids(await (await load()).json())).toEqual(expect.arrayContaining(["A-000002", "MB-000001"]));
  });

  it("a user who asked for a room they are not in gets 404", async () => {
    as("solo2", "User", DEPT_B, { departmentDenied: true });
    expect((await load()).status).toBe(404);
  });
});
