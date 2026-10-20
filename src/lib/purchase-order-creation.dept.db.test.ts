import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPT_A, DEPT_B, applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import type { PgliteSql } from "@/test/pglite-sql";
import type { DepartmentScope } from "@/lib/scoped-db";

// createPurchaseOrderWithAudit per department, against a real in-memory Postgres with the production schema + v30-v35.
// v36 (lab_profile per department) is applied on top and department B gets its own letterhead row (id 2), so B can create POs.
// Suggestions are NOT mocked (they run end to end), except in the one test that forces a stale suggestion.

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
import * as suggestions from "./purchase-order-suggestions";

const sql = dbSql as unknown as PgliteSql;
const scopeA: DepartmentScope = { mode: "one", departmentId: DEPT_A };
const scopeB: DepartmentScope = { mode: "one", departmentId: DEPT_B };
const user = { username: "creator", name: "Creator", role: "Admin" };

const itemA = { item_id: "A-000002", item_name: "Dept A extra item", quantity: 5, unit: "box", override_reason: "test" };
const itemB = { item_id: "MB-000001", item_name: "Dept B item 1", quantity: 5, unit: "box", override_reason: "test" };

function input(overrides: Record<string, unknown>) {
  return {
    user, vendor: "Vendor A", items: [itemA] as never, note: null, expectedDate: null, origin: "LAB" as const, scope: scopeA,
    ...overrides,
  } as Parameters<typeof createPurchaseOrderWithAudit>[0];
}
const inputB = (overrides: Record<string, unknown> = {}) => input({ vendor: "MB Vendor", items: [itemB], scope: scopeB, ...overrides });

const poRows = async () => (await sql.db.query<{ po_number: string; department_id: number }>(`SELECT po_number, department_id FROM purchase_orders ORDER BY id`)).rows;

const LETTERHEAD_B = { name: "MB Organization", department: "MB Letterhead Dept", address: "2 MB Road", phone: "02-000-0002", email: "mb@example.test" };
const insertLabProfileB = () => sql.db.query(
  `INSERT INTO lab_profile (id, department_id, organization_name, department_name, address, phone, email) VALUES (2, $1, $2, $3, $4, $5, $6)`,
  [DEPT_B, LETTERHEAD_B.name, LETTERHEAD_B.department, LETTERHEAD_B.address, LETTERHEAD_B.phone, LETTERHEAD_B.email],
);
const issuerOf = async (poNumber: string) =>
  (await sql.db.query<Record<string, string | null>>(
    `SELECT issuer_name, issuer_department, issuer_address, issuer_phone, issuer_email FROM purchase_orders WHERE po_number = $1`, [poNumber],
  )).rows[0];

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await sql.db.exec(`INSERT INTO lab_profile (id, organization_name, department_name) VALUES (1, 'Test Lab', 'Lab Dept') ON CONFLICT DO NOTHING`);
  await applyMigrationFile(sql.db, "upgrade_v36_lab_profile_per_department.sql");
  await insertLabProfileB();
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
  ["with liff_request_id", true],
  ["without liff_request_id", false],
])("createPurchaseOrderWithAudit (%s)", (_name, storeLiffRequestId) => {
  const extra = storeLiffRequestId ? { storeLiffRequestId: true, liffRequestId: "req-1" } : {};

  it("stamps the PO with the department of the scope (B -> 2)", async () => {
    const created = await createPurchaseOrderWithAudit(inputB(extra));
    expect(created.purchaseOrder.department_id).toBe(DEPT_B);
    expect(await poRows()).toEqual([expect.objectContaining({ department_id: DEPT_B })]);
  });

  it("stamps department A for scope A (control)", async () => {
    await createPurchaseOrderWithAudit(input(extra));
    expect(await poRows()).toEqual([expect.objectContaining({ department_id: DEPT_A })]);
  });

  it("scope B with department A's item is rejected and no PO row is created", async () => {
    await expect(createPurchaseOrderWithAudit(inputB({ vendor: "Vendor A", items: [itemA], ...extra }))).rejects.toThrow(/ไม่ใช่น้ำยาที่ใช้งานอยู่/); // rejected by the suggestions check, not by the insert
    expect(await poRows()).toEqual([]);
  });

  it("an item that stopped belonging to the department between the check and the insert gives 409 and no PO row", async () => {
    // Force a suggestion for A's item while writing for B: only the inactive_items join (filtered by B) can catch it now.
    const real = await vi.importActual<typeof import("./purchase-order-suggestions")>("./purchase-order-suggestions");
    h.override = (_sql, options) => real.getPurchaseOrderSuggestions(sql as never, options as never, { mode: "legacy" });
    // B HAS a letterhead row here, so the 409 must come from inactive_items (the old stale message), not from a missing letterhead.
    const error = await createPurchaseOrderWithAudit(inputB({ vendor: "Vendor A", items: [itemA], ...extra })).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, message: "สถานะสต็อกหรือ PO ค้างเปลี่ยนไประหว่างคำนวณ กรุณากดแนะนำอัตโนมัติและตรวจสอบอีกครั้ง" });
    expect(error).not.toMatchObject({ code: "PO_LETTERHEAD_MISSING" });
    expect(await poRows()).toEqual([]);
  });

  it("department B gets B's own letterhead in issuer_* (not the CC row)", async () => {
    const created = await createPurchaseOrderWithAudit(inputB(extra));
    expect(await issuerOf(String(created.purchaseOrder.po_number))).toEqual({
      issuer_name: LETTERHEAD_B.name, issuer_department: LETTERHEAD_B.department, issuer_address: LETTERHEAD_B.address,
      issuer_phone: LETTERHEAD_B.phone, issuer_email: LETTERHEAD_B.email,
    });
  });

  it("department A keeps the CC letterhead (id 1)", async () => {
    const created = await createPurchaseOrderWithAudit(input(extra));
    const issuer = await issuerOf(String(created.purchaseOrder.po_number));
    expect(issuer?.issuer_name).not.toBe(LETTERHEAD_B.name);
    expect(issuer?.issuer_address).not.toBe(LETTERHEAD_B.address);
  });

  it("a deleted letterhead row for B refuses creation (PO_LETTERHEAD_MISSING) and writes nothing", async () => {
    await sql.db.exec(`DELETE FROM lab_profile WHERE id = 2`);
    try {
      await expect(createPurchaseOrderWithAudit(inputB(extra))).rejects.toMatchObject({ code: "PO_LETTERHEAD_MISSING", status: 409 });
      expect(await poRows()).toEqual([]);
    } finally {
      await insertLabProfileB();
    }
  });

  it("a blank users.department falls back to the department_name of B's row; a filled one still wins", async () => {
    await sql.db.exec(`INSERT INTO users (username, password_hash, name, role, department) VALUES ('creator', 'x', 'Creator', 'Admin', '   ')`);
    try {
      const blank = await createPurchaseOrderWithAudit(inputB(extra));
      expect((await issuerOf(String(blank.purchaseOrder.po_number)))?.issuer_department).toBe(LETTERHEAD_B.department);
      await sql.db.exec(`UPDATE users SET department = 'Personal Dept' WHERE username = 'creator'`);
      const filled = await createPurchaseOrderWithAudit(inputB({ ...extra, ...(storeLiffRequestId ? { liffRequestId: "req-2" } : {}) }));
      expect((await issuerOf(String(filled.purchaseOrder.po_number)))?.issuer_department).toBe("Personal Dept");
    } finally {
      await sql.db.exec(`DELETE FROM users WHERE username = 'creator'`);
    }
  });

  it("mode all (Admin viewing every department) cannot create: DEPARTMENT_READ_ONLY before any SQL", async () => {
    const query = vi.spyOn(sql.db, "query");
    const transaction = vi.spyOn(sql.db, "transaction");
    await expect(createPurchaseOrderWithAudit(input({ scope: { mode: "all" }, ...extra }))).rejects.toMatchObject({ code: "DEPARTMENT_READ_ONLY" });
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(await poRows()).toEqual([]);
  });

  it.each([
    ["undefined", undefined],
    ["a user object", { username: "admin1", scope: DEPT_A }],
    ["mode one without id", { mode: "one" }],
  ])("a malformed scope (%s) throws before any SQL", async (_n, scope) => {
    const query = vi.spyOn(sql.db, "query");
    const transaction = vi.spyOn(sql.db, "transaction");
    await expect(createPurchaseOrderWithAudit(input({ scope, ...extra }))).rejects.toThrow("requires a DepartmentScope");
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("legacy scope sends SQL without department_id and the row gets the column default", async () => {
    const transaction = vi.spyOn(sql, "transaction");
    await createPurchaseOrderWithAudit(input({ scope: { mode: "legacy" }, ...extra }));
    const texts = (transaction.mock.calls[0][0] as unknown as Array<{ text: string }>).map((query) => query.text);
    expect(texts.length).toBe(3);
    expect(texts.filter((text) => /department_id/i.test(text))).toEqual([]);
    expect(await poRows()).toEqual([expect.objectContaining({ department_id: DEPT_A })]);
  });

  it("the department scope adds department_id to the insert and the inactive_items join", async () => {
    const transaction = vi.spyOn(sql, "transaction");
    await createPurchaseOrderWithAudit(inputB(extra));
    const insert = (transaction.mock.calls[0][0] as unknown as Array<{ text: string }>)[2].text;
    expect(insert).toMatch(/issuer_logo_url, department_id\s*\)/);
    expect(insert).toMatch(/master_data master ON master\.item_id = input\.item_id AND master\.department_id = /);
  });

  it("a PO of department B holding A's item does not make A's creation fail (current_open == on_order snapshot)", async () => {
    await insertPurchaseOrder(sql, { poNumber: "PO-B-HOLD", departmentId: DEPT_B, status: "SUBMITTED", itemId: "A-000002", quantity: 7, vendor: "MB Vendor" });
    const [suggested] = await suggestions.getPurchaseOrderSuggestions(sql as never, { vendor: "Vendor A", itemIds: ["A-000002"], includeAll: true, includeUnconfigured: true }, scopeA);
    expect(suggested.committed_no_eta_qty).toBe(7); // the suggestion counts B's PO (on_order is unfiltered)
    const created = await createPurchaseOrderWithAudit(input(extra)); // would be a 409 if current_open disagreed
    expect(created.purchaseOrder.department_id).toBe(DEPT_A);
  });
});

describe("existing POs keep their issuer_* snapshot", () => {
  // Regression lock only: no mutation of the creation code can break it (the snapshot is copied once, at insert).
  it("editing B's lab_profile and creating another PO does not change the first PO", async () => {
    const first = await createPurchaseOrderWithAudit(inputB());
    const before = await issuerOf(String(first.purchaseOrder.po_number));
    await sql.db.exec(`UPDATE lab_profile SET organization_name = 'Renamed', address = 'Moved' WHERE id = 2`);
    try {
      const second = await createPurchaseOrderWithAudit(inputB());
      expect(await issuerOf(String(first.purchaseOrder.po_number))).toEqual(before);
      expect(await issuerOf(String(second.purchaseOrder.po_number))).toMatchObject({ issuer_name: "Renamed", issuer_address: "Moved" });
    } finally {
      await sql.db.exec(`DELETE FROM lab_profile WHERE id = 2`);
      await insertLabProfileB();
    }
  });
});

describe("PO numbers are one global sequence per day", () => {
  it("A gets -001, then B gets -002", async () => {
    const first = await createPurchaseOrderWithAudit(input({}));
    const second = await createPurchaseOrderWithAudit(inputB());
    expect(String(first.purchaseOrder.po_number)).toMatch(/-001$/);
    expect(String(second.purchaseOrder.po_number)).toMatch(/-002$/);
  });
});
