import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Department behaviour of recordPurchaseOrderCommunication / listPurchaseOrderEvents (G5 PR-3) on the real production
// schema + v30-v35 (PGlite). Readiness is real: DEPARTMENTS_ENABLED=true and the migrated schema passes the probe.
vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("next/server", () => ({ after: () => { throw new Error("no request scope"); } }));

import dbSql from "@/lib/db";
import type { AuthenticatedUser } from "@/lib/auth-utils";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import type { DepartmentScope } from "@/lib/scoped-db";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { addPurchaseOrderTables, insertPurchaseOrder } from "@/test/purchase-order-dept-fixtures";
import { listPurchaseOrderEvents, recordPurchaseOrderCommunication } from "./po-communication";

const sql = dbSql as unknown as PgliteSql;
let poA: number;
let poB: number;

const rows = async <T>(query: string, params: unknown[] = []) => (await sql.db.query<T>(query, params)).rows;
const outbox = (poId: number) => rows<{ recipient_username: string; recipient_role: string; channel: string; department_id: number; recipient_address: string }>(
  "SELECT recipient_username, recipient_role, channel, department_id, recipient_address FROM notification_outbox WHERE po_id = $1 ORDER BY recipient_username, channel",
  [poId],
);
const recipientsOf = async (poId: number) => [...new Set((await outbox(poId)).map((row) => row.recipient_username))].sort();

beforeAll(async () => {
  process.env.DEPARTMENTS_ENABLED = "true";
  resetDepartmentsFlagForTests();
  await seedTwoDepartments(sql);
  await addPurchaseOrderTables(sql);
  // The shared production DDL keeps purchase_order_events minimal; these are the columns recordPurchaseOrderCommunication writes.
  await sql.db.exec(`
    ALTER TABLE purchase_order_events
      ADD COLUMN from_status TEXT, ADD COLUMN to_status TEXT, ADD COLUMN actor_username TEXT, ADD COLUMN actor_role TEXT,
      ADD COLUMN source TEXT NOT NULL DEFAULT 'WEB', ADD COLUMN visibility TEXT NOT NULL DEFAULT 'BOTH',
      ADD COLUMN note TEXT, ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT,
      notify_po_created BOOLEAN, notify_po_confirmed BOOLEAN, notify_po_shipped BOOLEAN,
      notify_po_received BOOLEAN, notify_po_status_updates BOOLEAN
    );
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('adminA',  'x', 'Admin A',  'Admin',   ''),
      ('mgrA',    'x', 'Mgr A',    'Manager', ''),
      ('adminB',  'x', 'Admin B',  'Admin',   ''),
      ('mgrB',    'x', 'Mgr B',    'Manager', ''),
      ('adminAB', 'x', 'Admin AB', 'Admin',   ''),
      ('adminNone', 'x', 'Admin none', 'Admin', ''),
      ('mgrOver', 'x', 'Mgr override', 'Manager', ''),
      ('vendorP', 'x', 'Vendor PCL', 'Vendor', 'PCL'),
      ('vendorO', 'x', 'Vendor other', 'Vendor', 'OTHER');
    INSERT INTO user_departments (username, department_id, role, is_default) VALUES
      ('adminA', ${DEPT_A}, NULL, true),
      ('mgrA', ${DEPT_A}, NULL, true),
      ('adminB', ${DEPT_B}, NULL, true),
      ('mgrB', ${DEPT_B}, NULL, true),
      ('adminAB', ${DEPT_A}, NULL, true),
      ('adminAB', ${DEPT_B}, NULL, false),
      ('mgrOver', ${DEPT_B}, 'User', true);
  `);
}, 60_000);

afterAll(async () => {
  delete process.env.DEPARTMENTS_ENABLED;
  resetDepartmentsFlagForTests();
  await sql.db.close();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await sql.db.exec(`
    TRUNCATE purchase_order_events, notification_outbox, purchase_order_items, purchase_orders RESTART IDENTITY CASCADE;
    DELETE FROM notification_settings;
    INSERT INTO notification_settings (username, email) VALUES
      ('adminA', 'adminA@lab.test'), ('mgrA', 'mgrA@lab.test'), ('adminB', 'adminB@lab.test'), ('mgrB', 'mgrB@lab.test'),
      ('adminAB', 'adminAB@lab.test'), ('adminNone', 'adminNone@lab.test'), ('mgrOver', 'mgrOver@lab.test'),
      ('vendorP', 'vendorP@lab.test'), ('vendorO', 'vendorO@lab.test');
  `);
  poA = (await insertPurchaseOrder(sql, { poNumber: "PO-A", departmentId: DEPT_A, status: "SUBMITTED", vendor: "PCL" })).poId;
  poB = (await insertPurchaseOrder(sql, { poNumber: "PO-B", departmentId: DEPT_B, status: "SUBMITTED", vendor: "PCL" })).poId;
});

describe("recordPurchaseOrderCommunication with departments ready", () => {
  it("T1: stamps the outbox with the department of the PO itself, whoever the caller is", async () => {
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_CREATED", actor: { username: "adminA", role: "Admin" } });
    await recordPurchaseOrderCommunication({ poId: poA, eventType: "PO_CREATED", source: "SYSTEM" });

    const b = await outbox(poB);
    const a = await outbox(poA);
    expect(b.length).toBeGreaterThan(0);
    expect(b.map((row) => row.department_id)).toEqual(b.map(() => DEPT_B));
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((row) => row.department_id)).toEqual(a.map(() => DEPT_A));
  });

  it("T2: Admin/Manager are notified only when members of the PO's department (AND binds tighter than the role OR)", async () => {
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_REVIEW_REQUIRED", source: "SYSTEM" });
    await recordPurchaseOrderCommunication({ poId: poA, eventType: "PO_REVIEW_REQUIRED", source: "SYSTEM" });

    // adminNone has no membership row at all: gets nothing (accepted; needs the v30 backfill before enabling the flag).
    expect(await recipientsOf(poB)).toEqual(["adminAB", "adminB", "mgrB", "mgrOver"]);
    expect(await recipientsOf(poA)).toEqual(["adminA", "adminAB", "mgrA"]);
    // a member of both departments gets each PO exactly once
    expect((await outbox(poB)).filter((row) => row.recipient_username === "adminAB")).toHaveLength(1);
    expect((await outbox(poA)).filter((row) => row.recipient_username === "adminAB")).toHaveLength(1);
  });

  it("T3: the Vendor of the PO's company is notified without any membership; another company is not", async () => {
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_CREATED", actor: { username: "adminB", role: "Admin" } });
    expect(await recipientsOf(poB)).toEqual(["vendorP"]);

    // the same company in two departments is notified for both (accepted for now: open question #3)
    await recordPurchaseOrderCommunication({ poId: poA, eventType: "PO_CREATED", actor: { username: "adminA", role: "Admin" } });
    expect(await recipientsOf(poA)).toEqual(["vendorP"]);
  });

  it("T4: a per-department role override does not change who is notified (known limitation: system-wide users.role)", async () => {
    // mgrOver is a Manager system-wide but 'User' in department B; still treated as a Manager recipient.
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_REVIEW_REQUIRED", source: "SYSTEM" });
    const mgrOver = (await outbox(poB)).filter((row) => row.recipient_username === "mgrOver");
    expect(mgrOver.map((row) => row.recipient_role)).toEqual(["Manager"]);
  });

  it("dedupes by address: two usernames sharing one email get one message", async () => {
    await sql.db.exec("UPDATE notification_settings SET email = 'shared@lab.test' WHERE username IN ('adminB', 'mgrB')");
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_REVIEW_REQUIRED", source: "SYSTEM" });

    const shared = (await outbox(poB)).filter((row) => row.recipient_address === "shared@lab.test");
    expect(shared).toHaveLength(1);
  });

  it("T5: a PO without a department fails closed: timeline row recorded, nobody queued, no throw", async () => {
    await sql.db.exec("ALTER TABLE purchase_orders ALTER COLUMN department_id DROP NOT NULL");
    try {
      await sql.db.query("UPDATE purchase_orders SET department_id = NULL WHERE id = $1", [poB]);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_REVIEW_REQUIRED", source: "SYSTEM" });

      expect(result.queued).toBe(0);
      expect(result.eventId).not.toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      expect(await outbox(poB)).toEqual([]);
      const events = await rows<{ event_type: string }>("SELECT event_type FROM purchase_order_events WHERE po_id = $1", [poB]);
      expect(events.map((row) => row.event_type)).toEqual(["PO_REVIEW_REQUIRED"]);
    } finally {
      await sql.db.query("UPDATE purchase_orders SET department_id = $1 WHERE id = $2", [DEPT_B, poB]);
      await sql.db.exec("ALTER TABLE purchase_orders ALTER COLUMN department_id SET NOT NULL");
    }
  });
});

describe("listPurchaseOrderEvents with a department scope", () => {
  const lab = { username: "adminB", role: "Admin" } as unknown as AuthenticatedUser;
  const vendor = { username: "vendorP", role: "Vendor", vendor: "PCL" } as unknown as AuthenticatedUser;
  const otherVendor = { username: "vendorO", role: "Vendor", vendor: "OTHER" } as unknown as AuthenticatedUser;

  beforeEach(async () => {
    await recordPurchaseOrderCommunication({ poId: poB, eventType: "PO_CREATED", source: "SYSTEM" });
  });

  it("T6: another department's PO is not found; the same department and mode all see it", async () => {
    expect(await listPurchaseOrderEvents(poB, lab, { mode: "one", departmentId: DEPT_A })).toBeNull();
    const own = await listPurchaseOrderEvents(poB, lab, { mode: "one", departmentId: DEPT_B });
    expect(own).toMatchObject({ items: [expect.objectContaining({ event_type: "PO_CREATED" })] });
    expect(await listPurchaseOrderEvents(poB, lab, { mode: "all" })).toMatchObject({ items: expect.any(Array) });
  });

  it("keeps the Vendor company check (legacy scope = not filtered by department)", async () => {
    expect(await listPurchaseOrderEvents(poB, vendor, { mode: "legacy" })).toMatchObject({ items: expect.any(Array) });
    expect(await listPurchaseOrderEvents(poB, otherVendor, { mode: "legacy" })).toBe("FORBIDDEN");
  });

  it("rejects malformed scopes before running any query", async () => {
    const bad: unknown[] = [undefined, {}, lab, { mode: "one" }, { mode: "one", departmentId: "2" }];
    for (const scope of bad) {
      await expect(listPurchaseOrderEvents(poB, lab, scope as DepartmentScope)).rejects.toThrow("listPurchaseOrderEvents requires a DepartmentScope");
    }
  });
});
