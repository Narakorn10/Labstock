import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

// Characterization of the reagent-loans route on the real production schema (departments off = legacy behavior).

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import dbSql from "@/lib/db";
import { applyProdSchema } from "@/test/department-fixtures";
import { GET, POST } from "./route";

const sql = dbSql as unknown as PgliteSql;
const staff = { username: "staff1", name: "Staff One", role: "Operator" };
const ACTOR = "Staff One (Operator)";

beforeAll(async () => {
  await applyProdSchema(sql.db);
}, 60_000);

afterAll(async () => {
  await sql.db.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getAuthenticatedUser.mockResolvedValue(staff);
  await sql.db.exec(`
    DELETE FROM reagent_loans;
    DELETE FROM logs;
    DELETE FROM inventory;
    UPDATE master_data SET is_active = TRUE;
    INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on) VALUES ('LAB-000001', 'L1', '2027-01-01', 5, '2026-09-01');
  `);
});

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/reagent-loans", { method: "POST", body: JSON.stringify(body) }));
}
const get = (query = "") => GET(new Request(`http://localhost/api/reagent-loans${query}`));
const rows = async <T>(query: string) => (await sql.db.query<T>(query)).rows;
const stock = async () => (await rows<{ lot_no: string; quantity: string }>(
  "SELECT lot_no, quantity FROM inventory WHERE item_id = 'LAB-000001' ORDER BY id",
)).map((row) => `${row.lot_no}=${Number(row.quantity)}`);

const borrow = { operation: "BORROW_IN", partnerName: "Lab B", batchItems: [{ itemId: "LAB-000001", lotNo: "LN", expDate: "2028-01-01", qty: 4 }] };
const lend = { operation: "LEND_OUT", partnerName: "Lab B", batchItems: [{ itemId: "LAB-000001", lotNo: "L1", qty: 2 }] };

describe("GET /api/reagent-loans (legacy)", () => {
  it("answers 401 without a user", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("lists OPEN loans, optionally by direction", async () => {
    await post(borrow);
    await post(lend);

    const all = await (await get()).json();
    expect(all.map((row: { direction: string }) => row.direction).sort()).toEqual(["BORROWED_IN", "LENT_OUT"]);
    const lent = await (await get("?direction=LENT_OUT")).json();
    expect(lent).toHaveLength(1);
    expect(Number(lent[0].remaining_qty)).toBe(2);
    expect((await get("?direction=BAD")).status).toBe(400);
  });
});

describe("POST /api/reagent-loans (legacy)", () => {
  it("validates the request", async () => {
    expect((await post({ operation: "NOPE", partnerName: "x", batchItems: [{}] })).status).toBe(400);
    expect((await post({ ...borrow, batchItems: [{ itemId: "LAB-000001", lotNo: "", qty: 1 }] })).status).toBe(400);
  });

  it("answers 409 REAGENT_INACTIVE for an unknown or inactive item", async () => {
    const unknown = await post({ ...borrow, batchItems: [{ itemId: "NOPE", lotNo: "L", qty: 1 }] });
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).error).toBe("REAGENT_INACTIVE: NOPE");
    await sql.db.exec("UPDATE master_data SET is_active = FALSE WHERE item_id = 'LAB-000001'");
    expect((await post(borrow)).status).toBe(409);
  });

  it("BORROW_IN adds stock, a log row and an open loan", async () => {
    const response = await post(borrow);

    expect(response.status).toBe(200);
    expect(await stock()).toEqual(["L1=5", "LN=4"]);
    expect((await rows<{ action: string; username: string }>("SELECT action, username FROM logs"))).toEqual([{ action: "ยืมเข้าคลัง", username: ACTOR }]);
    const loans = await rows<{ direction: string; created_by: string }>("SELECT direction, created_by FROM reagent_loans");
    expect(loans).toEqual([{ direction: "BORROWED_IN", created_by: ACTOR }]);
  });

  it("LEND_OUT reduces stock and opens a loan; 409 when stock is not enough", async () => {
    expect((await post(lend)).status).toBe(200);
    expect(await stock()).toEqual(["L1=3"]);
    expect((await rows("SELECT 1 FROM reagent_loans WHERE direction = 'LENT_OUT'"))).toHaveLength(1);

    const tooMuch = await post({ ...lend, batchItems: [{ itemId: "LAB-000001", lotNo: "L1", qty: 99 }] });
    expect(tooMuch.status).toBe(409);
    expect(await stock()).toEqual(["L1=3"]);
  });

  // KNOWN PRE-EXISTING BUG (found while writing these tests): the RETURN_IN / RETURN_OUT statements end with
  // `EXISTS (SELECT 1 FROM logged)` but the `logged` CTE is an INSERT without RETURNING, which Postgres rejects
  // ("WITH query "logged" does not have a RETURNING clause"). So every return currently answers 500 and changes nothing.
  // These tests pin that behaviour; when the SQL is fixed they should be changed to expect 200 / 409.
  it("RETURN_IN currently fails with 500 and changes nothing (known bug, see comment)", async () => {
    await post(lend);
    const loan = (await rows<{ id: number }>("SELECT id FROM reagent_loans"))[0];

    const response = await post({ operation: "RETURN_IN", partnerName: "Lab B", batchItems: [{ itemId: "LAB-000001", lotNo: "L1", qty: 2, loanId: loan.id }] });

    expect(response.status).toBe(500);
    expect(await stock()).toEqual(["L1=3"]);
    expect((await rows<{ status: string }>("SELECT status FROM reagent_loans"))).toEqual([{ status: "OPEN" }]);
  });

  it("RETURN_IN without a loan id answers 400", async () => {
    expect((await post({ operation: "RETURN_IN", partnerName: "Lab B", batchItems: [{ itemId: "LAB-000001", lotNo: "L1", qty: 2 }] })).status).toBe(400);
  });

  it("RETURN_OUT currently fails with 500 and changes nothing (known bug, see comment above)", async () => {
    await post(borrow);
    const loan = (await rows<{ id: number }>("SELECT id FROM reagent_loans"))[0];

    const response = await post({ operation: "RETURN_OUT", partnerName: "Lab B", batchItems: [{ itemId: "LAB-000001", lotNo: "LN", qty: 4, loanId: loan.id }] });

    expect(response.status).toBe(500);
    expect(await stock()).toEqual(["L1=5", "LN=4"]);
  });
});
