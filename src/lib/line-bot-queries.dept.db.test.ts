import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// PO / tracking lookups of the LINE bot per actor on the production schema + v30-v35 (PGlite): a lab actor stays inside its
// department, a vendor actor sees only its own vendor across departments, and never a PO still under manager review.
// PGlite is not Neon: check on real Neon at rehearsal.

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "@/lib/db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import type { LineBotActor } from "./line-bot-queries";
import { findPurchaseOrderForLine, findShipmentForLine } from "./line-bot-queries";

const sql = dbSql as unknown as PgliteSql;
const labA: LineBotActor = { kind: "lab", scope: { mode: "one", departmentId: DEPT_A } };
const labB: LineBotActor = { kind: "lab", scope: { mode: "one", departmentId: DEPT_B } };
const vendor = (name: string): LineBotActor => ({ kind: "vendor", vendor: name });

async function insertShipment(trackingNo: string, vendorName: string, departmentId: number, itemId: string) {
  await sql.db.query(
    "INSERT INTO shipments (vendor, item_id, lot_no, quantity, tracking_no, department_id) VALUES ($1, $2, 'L1', 1, $3, $4)",
    [vendorName, itemId, trackingNo, departmentId],
  );
}

beforeAll(async () => {
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  await insertPurchaseOrder(sql, { poNumber: "PO-A-V1", departmentId: DEPT_A, status: "SENT", vendor: "V1" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B-V1", departmentId: DEPT_B, status: "SENT", vendor: "V1", itemId: "MB-000001" });
  await insertPurchaseOrder(sql, { poNumber: "PO-B-V2", departmentId: DEPT_B, status: "SENT", vendor: "V2", itemId: "MB-000001" });
  await insertPurchaseOrder(sql, { poNumber: "PO-A-V1-REVIEW", departmentId: DEPT_A, status: "PENDING_MANAGER_REVIEW", vendor: "V1" });
  // Decoy: a PO with an empty vendor, which a blank vendor must never match.
  await insertPurchaseOrder(sql, { poNumber: "PO-A-BLANK", departmentId: DEPT_A, status: "SENT", vendor: "" });
  await insertShipment("AA111111111TH", "V1", DEPT_A, "LAB-000001");
  await insertShipment("BB222222222TH", "V1", DEPT_B, "MB-000001");
  await insertShipment("CC333333333TH", "V2", DEPT_B, "MB-000001");
  await insertShipment("DD444444444TH", "", DEPT_A, "LAB-000001");
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.db.close();
});

describe("seed controls", () => {
  it("the rows used below really exist", async () => {
    const pos = await sql.db.query<{ po_number: string; vendor: string; department_id: number }>(
      "SELECT po_number, vendor, department_id FROM purchase_orders WHERE po_number LIKE 'PO-A-%' OR po_number LIKE 'PO-B-%' ORDER BY po_number",
    );
    expect(pos.rows.map((r) => `${r.po_number}|${r.vendor}|${r.department_id}`)).toEqual([
      `PO-A-BLANK||${DEPT_A}`,
      `PO-A-V1|V1|${DEPT_A}`,
      `PO-A-V1-REVIEW|V1|${DEPT_A}`,
      `PO-B-V1|V1|${DEPT_B}`,
      `PO-B-V2|V2|${DEPT_B}`,
    ]);
    const ships = await sql.db.query<{ tracking_no: string; vendor: string; department_id: number }>(
      "SELECT tracking_no, vendor, department_id FROM shipments WHERE tracking_no IS NOT NULL ORDER BY tracking_no",
    );
    expect(ships.rows.map((r) => `${r.tracking_no}|${r.vendor}|${r.department_id}`)).toEqual([
      `AA111111111TH|V1|${DEPT_A}`,
      `BB222222222TH|V1|${DEPT_B}`,
      `CC333333333TH|V2|${DEPT_B}`,
      `DD444444444TH||${DEPT_A}`,
    ]);
  });
});

describe("lab actor", () => {
  it("sees its own department's PO and shipment (positive control)", async () => {
    expect((await findPurchaseOrderForLine("PO-A-V1", labA))?.po_number).toBe("PO-A-V1");
    expect((await findPurchaseOrderForLine("PO-B-V2", labB))?.po_number).toBe("PO-B-V2");
    expect((await findShipmentForLine("AA111111111TH", labA))?.tracking_no).toBe("AA111111111TH");
    expect((await findShipmentForLine("CC333333333TH", labB))?.tracking_no).toBe("CC333333333TH");
  });

  it("does not see another department's PO or shipment", async () => {
    expect(await findPurchaseOrderForLine("PO-B-V1", labA)).toBeNull();
    expect(await findPurchaseOrderForLine("PO-A-V1", labB)).toBeNull();
    expect(await findShipmentForLine("BB222222222TH", labA)).toBeNull();
    expect(await findShipmentForLine("AA111111111TH", labB)).toBeNull();
  });

  it("sees POs under manager review of its own department (web parity for lab)", async () => {
    expect((await findPurchaseOrderForLine("PO-A-V1-REVIEW", labA))?.status).toBe("PENDING_MANAGER_REVIEW");
  });
});

describe("vendor actor", () => {
  it("sees its own POs and shipments in BOTH departments (positive control)", async () => {
    expect((await findPurchaseOrderForLine("PO-A-V1", vendor("V1")))?.po_number).toBe("PO-A-V1");
    expect((await findPurchaseOrderForLine("PO-B-V1", vendor("V1")))?.po_number).toBe("PO-B-V1");
    expect((await findShipmentForLine("AA111111111TH", vendor("V1")))?.tracking_no).toBe("AA111111111TH");
    expect((await findShipmentForLine("BB222222222TH", vendor("V1")))?.tracking_no).toBe("BB222222222TH");
  });

  it("does not see another vendor's PO or shipment", async () => {
    expect(await findPurchaseOrderForLine("PO-B-V2", vendor("V1"))).toBeNull();
    expect(await findShipmentForLine("CC333333333TH", vendor("V1"))).toBeNull();
    // Control: V2 does see them, so the nulls above are not an empty-table artefact.
    expect((await findPurchaseOrderForLine("PO-B-V2", vendor("V2")))?.po_number).toBe("PO-B-V2");
    expect((await findShipmentForLine("CC333333333TH", vendor("V2")))?.tracking_no).toBe("CC333333333TH");
  });

  it("never sees its own PO while it is PENDING_MANAGER_REVIEW; shipments have no status rule", async () => {
    expect(await findPurchaseOrderForLine("PO-A-V1-REVIEW", vendor("V1"))).toBeNull();
    // Control: the PO exists and the lab of that department sees it.
    expect((await findPurchaseOrderForLine("PO-A-V1-REVIEW", labA))?.po_number).toBe("PO-A-V1-REVIEW");
  });

  it("a blank vendor returns null without sending any SQL and never matches vendor = ''", async () => {
    const spy = vi.spyOn(sql.db, "query");
    for (const name of ["", "  ", "\t"]) {
      expect(await findPurchaseOrderForLine("PO-A-BLANK", vendor(name))).toBeNull();
      expect(await findShipmentForLine("DD444444444TH", vendor(name))).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    // Control: the decoy rows exist and a lab actor sees them.
    expect((await findPurchaseOrderForLine("PO-A-BLANK", labA))?.vendor).toBe("");
    expect((await findShipmentForLine("DD444444444TH", labA))?.vendor).toBe("");
  });
});
