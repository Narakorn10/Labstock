import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables } from "@/test/purchase-order-dept-fixtures";
import type { PgliteSql } from "@/test/pglite-sql";
import type { DepartmentScope } from "@/lib/scoped-db";

// Letterhead (lab_profile) per department in createPurchaseOrderWithAudit, in the world WITHOUT v36 (the state of production
// when this code ships): lab_profile holds only the CC row (id 1, department_id 1) and the CHECK id = 1 is still there.
// Department B has no row, so it must be refused and never get the CC letterhead. The with-v36 cases live in
// purchase-order-creation.dept.db.test.ts.

const h = vi.hoisted(() => ({ override: null as null | ((...args: unknown[]) => Promise<unknown>) }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

vi.mock("./purchase-order-suggestions", async (importOriginal) => {
  const real = await importOriginal<typeof import("./purchase-order-suggestions")>();
  return {
    ...real,
    getPurchaseOrderSuggestions: (...args: unknown[]) =>
      h.override ? h.override(...args) : (real.getPurchaseOrderSuggestions as (...a: unknown[]) => Promise<unknown>)(...args),
  };
});

import dbSql from "@/lib/db";
import { createPurchaseOrderWithAudit } from "./purchase-order-creation";

const sql = dbSql as unknown as PgliteSql;
const scopeA: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const scopeB: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const user = { username: "creator", name: "Creator", role: "Admin" };
const itemA = { item_id: "A-000002", item_name: "Dept A extra item", quantity: 5, unit: "box", override_reason: "test" };
const itemB = { item_id: "MB-000001", item_name: "Dept B item 1", quantity: 5, unit: "box", override_reason: "test" };

const STALE_MESSAGE = "สถานะสต็อกหรือ PO ค้างเปลี่ยนไประหว่างคำนวณ กรุณากดแนะนำอัตโนมัติและตรวจสอบอีกครั้ง";
const LETTERHEAD_MESSAGE = "ยังไม่ได้ตั้งหัวกระดาษใบสั่งซื้อของงานนี้ กรุณาติดต่อผู้ดูแลระบบ";

function inputFor(dept: "A" | "B", overrides: Record<string, unknown> = {}) {
  return {
    user, note: null, expectedDate: null, origin: "LAB" as const,
    vendor: dept === "A" ? "Vendor A" : "MB Vendor", items: [dept === "A" ? itemA : itemB], scope: dept === "A" ? scopeA : scopeB,
    ...overrides,
  } as Parameters<typeof createPurchaseOrderWithAudit>[0];
}

const count = async (table: string) => Number((await sql.db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  // The seed already holds the CC row; give it recognisable fields (department_id = 1 comes from the v31 default).
  await sql.db.exec(`UPDATE lab_profile SET organization_name = 'CC Organization', department_name = 'CC Dept', address = '1 CC Road' WHERE id = 1`);
}, 120_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  h.override = null;
  vi.restoreAllMocks();
  await sql.db.exec(`TRUNCATE shipments, shipment_batches, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;`);
});

describe.each([
  ["with liff_request_id", { storeLiffRequestId: true, liffRequestId: "req-1" }],
  ["without liff_request_id", {}],
])("letterhead without v36 (%s)", (_name, extra) => {
  it("(a) department A (scope one) gets the CC row as its letterhead", async () => {
    const created = await createPurchaseOrderWithAudit(inputFor("A", extra));
    expect(created.purchaseOrder).toMatchObject({ department_id: DEPT_A, issuer_name: "CC Organization", issuer_department: "CC Dept", issuer_address: "1 CC Road" });
  });

  it("(b) department B has no row: refused with PO_LETTERHEAD_MISSING (409, Thai message) and NOTHING is written", async () => {
    const error = await createPurchaseOrderWithAudit(inputFor("B", extra)).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "AppError", code: "PO_LETTERHEAD_MISSING", status: 409, userMessage: LETTERHEAD_MESSAGE });
    expect((error as { hint: string }).hint).toMatch(/\S/);
    expect(await count("purchase_orders")).toBe(0);
    expect(await count("purchase_order_items")).toBe(0);
  });

  it("(d) no letterhead AND an item that is inactive for B: the letterhead error wins over the stale/inactive 409", async () => {
    // Force a suggestion for A's item while writing for B (as in creation.dept.db.test.ts): inactive_items fires as well.
    const real = await vi.importActual<typeof import("./purchase-order-suggestions")>("./purchase-order-suggestions");
    h.override = (_sql, options) => real.getPurchaseOrderSuggestions(sql as never, options as never, { mode: "legacy" });
    const error = await createPurchaseOrderWithAudit(inputFor("B", { ...extra, vendor: "Vendor A", items: [itemA] })).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "PO_LETTERHEAD_MISSING", status: 409, userMessage: LETTERHEAD_MESSAGE });
    expect(error).not.toMatchObject({ message: STALE_MESSAGE });
    expect(await count("purchase_orders")).toBe(0);
  });
});

describe("(c) the world has no v36", () => {
  it("inserting a second lab_profile row fails by the id = 1 CHECK", async () => {
    await expect(
      sql.db.query(`INSERT INTO lab_profile (id, department_id, organization_name) VALUES (2, $1, 'MB')`, [DEPT_B]),
    ).rejects.toThrow(/lab_profile_id_check|check constraint/i);
    expect(await count("lab_profile")).toBe(1);
  });
});
