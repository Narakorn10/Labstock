import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { apiError, isDepartmentScopeFailure, toApiError } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-observability";
import { andDept, andDeptWrite, deptInsert, getDepartmentScope, writeDepartmentId } from "@/lib/scoped-db";

const directions = new Set(["BORROWED_IN", "LENT_OUT"]);
const operations = new Set(["BORROW_IN", "LEND_OUT", "RETURN_IN", "RETURN_OUT"]);

type LoanItem = {
  itemId?: unknown;
  lotNo?: unknown;
  expDate?: unknown;
  qty?: unknown;
  loanId?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// The inventory upserts below conflict on (item_id, lot_no, received_on). If that exact row belongs to another
// department (inconsistent data) it must not be added to or relabelled, so refuse before touching it (departments on only).
function crossDeptAssert(departmentId: number, itemId: string, lotNo: string) {
  return sql`
    SELECT labstock_assert(NOT EXISTS (
      SELECT 1 FROM inventory
      WHERE item_id = ${itemId} AND lot_no = ${lotNo} AND received_on = CURRENT_DATE
        AND department_id <> ${departmentId}
    ), 'ITEM_NOT_IN_DEPARTMENT: ' || ${itemId}::text) AS ok
  `;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope = await getDepartmentScope(user);

    const { searchParams } = new URL(request.url);
    const direction = searchParams.get("direction") || "";
    if (direction && !directions.has(direction)) {
      return NextResponse.json({ error: "Invalid loan direction" }, { status: 400 });
    }

    const rows = await sql`
      SELECT id, direction, partner_name, item_id, item_name, lot_no,
        exp_date, quantity, returned_qty, quantity - returned_qty AS remaining_qty,
        status, loaned_at
      FROM reagent_loans
      WHERE status = 'OPEN'
        AND (${direction}::text = '' OR direction = ${direction})${andDept(scope)}
      ORDER BY loaned_at ASC, id ASC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    if (isDepartmentScopeFailure(error)) return toApiError(error, requestId).response;
    const message = error instanceof Error ? error.message : "Unable to load outstanding loans";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope = await getDepartmentScope(user);
    // Mode "all" (viewing every department) cannot write: throws DEPARTMENT_READ_ONLY before any SQL runs.
    writeDepartmentId(scope);
    const d = deptInsert(scope);

    const body = await request.json() as { operation?: unknown; partnerName?: unknown; batchItems?: LoanItem[] };
    const operation = text(body.operation);
    const partnerName = text(body.partnerName);
    const items = Array.isArray(body.batchItems) ? body.batchItems : [];
    if (!operations.has(operation) || !partnerName || !items.length) {
      return NextResponse.json({ error: "Loan operation, unit, and at least one item are required" }, { status: 400 });
    }

    const requestedItemIds = Array.from(new Set(items.map((item) => text(item.itemId)).filter(Boolean)));
    const masterRows = await sql`
      SELECT item_id, is_active
      FROM master_data
      WHERE item_id = ANY(${requestedItemIds})${andDept(scope)}
    `;
    const masterById = new Map(masterRows.map((row) => [String(row.item_id), row]));
    // Departments on: an item outside the user's department (or one that does not exist) looks the same to them.
    if (scope.mode === "one") {
      const foreign = requestedItemIds.find((itemId) => !masterById.has(itemId));
      if (foreign) return apiError("ITEM_NOT_IN_DEPARTMENT", { requestId, message: `รายการนี้ไม่อยู่ในงานของคุณ (${foreign})` });
    }
    const blockedItem = requestedItemIds.find((itemId) => !masterById.has(itemId) || masterById.get(itemId)?.is_active === false);
    if (blockedItem) {
      return NextResponse.json({ error: `REAGENT_INACTIVE: ${blockedItem}` }, { status: 409 });
    }

    const actor = user.name ? `${user.name} (${user.role})` : user.username;
    for (const item of items) {
      const itemId = text(item.itemId);
      const lotNo = text(item.lotNo);
      const expDate = text(item.expDate) || null;
      const qty = quantity(item.qty);
      const loanId = Number(item.loanId);
      if (!itemId || !lotNo || !qty) return NextResponse.json({ error: "Item, lot, and quantity must be valid" }, { status: 400 });

      let result: Record<string, unknown>[];
      if (operation === "BORROW_IN") {
        const borrow = sql`
          WITH master AS (SELECT item_id, name FROM master_data WHERE item_id = ${itemId}${andDept(scope)}),
          stocked AS (INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on${d.column})
            SELECT item_id, ${lotNo}, ${expDate}, ${qty}, CURRENT_DATE${d.value} FROM master
            ON CONFLICT (item_id, lot_no, received_on) DO UPDATE SET quantity = inventory.quantity + ${qty}, exp_date = COALESCE(EXCLUDED.exp_date, inventory.exp_date)
            RETURNING item_id, lot_no),
          logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username${d.column})
            SELECT stocked.item_id, master.name, stocked.lot_no, 'ยืมเข้าคลัง', ${qty}, ${actor}${d.value} FROM stocked JOIN master ON master.item_id = stocked.item_id)
          INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, exp_date, quantity, created_by${d.column})
          SELECT 'BORROWED_IN', ${partnerName}, master.item_id, master.name, ${lotNo}, ${expDate}, ${qty}, ${actor}${d.value} FROM master
          RETURNING id
        `;
        result = scope.mode === "one" ? (await sql.transaction([crossDeptAssert(scope.departmentId, itemId, lotNo), borrow]))[1] : await borrow;
      } else if (operation === "LEND_OUT") {
        result = await sql`
          WITH master AS (SELECT item_id, name FROM master_data WHERE item_id = ${itemId}${andDept(scope)}),
          stocked AS (UPDATE inventory SET quantity = quantity - ${qty}
            WHERE id = (SELECT id FROM inventory WHERE item_id = ${itemId} AND lot_no = ${lotNo} AND quantity >= ${qty}${andDeptWrite(scope)} ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC LIMIT 1)
            RETURNING item_id, lot_no),
          logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username${d.column})
            SELECT stocked.item_id, master.name, stocked.lot_no, 'ให้ยืมออก', ${qty}, ${actor}${d.value} FROM stocked JOIN master ON master.item_id = stocked.item_id)
          INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, exp_date, quantity, created_by${d.column})
          SELECT 'LENT_OUT', ${partnerName}, master.item_id, master.name, ${lotNo}, ${expDate}, ${qty}, ${actor}${d.value} FROM master WHERE EXISTS (SELECT 1 FROM stocked)
          RETURNING id
        `;
      } else {
        const direction = operation === "RETURN_IN" ? "LENT_OUT" : "BORROWED_IN";
        const receive = operation === "RETURN_IN";
        if (!Number.isInteger(loanId) || loanId <= 0) return NextResponse.json({ error: "Select an outstanding loan before recording a return" }, { status: 400 });
        if (receive) {
          const returnIn = sql`
            WITH eligible AS (SELECT * FROM reagent_loans WHERE id = ${loanId} AND direction = ${direction} AND status = 'OPEN' AND partner_name = ${partnerName} AND item_id = ${itemId} AND lot_no = ${lotNo} AND quantity - returned_qty >= ${qty}${andDept(scope)}),
            stocked AS (INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on${d.column}) SELECT item_id, lot_no, exp_date, ${qty}, CURRENT_DATE${d.value} FROM eligible ON CONFLICT (item_id, lot_no, received_on) DO UPDATE SET quantity = inventory.quantity + ${qty} RETURNING item_id, lot_no),
            logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username${d.column}) SELECT eligible.item_id, eligible.item_name, eligible.lot_no, 'รับคืนจากผู้ยืม', ${qty}, ${actor}${d.value} FROM eligible JOIN stocked ON stocked.item_id = eligible.item_id AND stocked.lot_no = eligible.lot_no)
            UPDATE reagent_loans SET returned_qty = returned_qty + ${qty}, status = CASE WHEN returned_qty + ${qty} = quantity THEN 'CLOSED' ELSE 'OPEN' END, returned_at = CASE WHEN returned_qty + ${qty} = quantity THEN NOW() ELSE returned_at END, updated_by = ${actor}, updated_at = NOW() WHERE id = ${loanId}${andDeptWrite(scope)} AND EXISTS (SELECT 1 FROM logged) RETURNING id
          `;
          result = scope.mode === "one" ? (await sql.transaction([crossDeptAssert(scope.departmentId, itemId, lotNo), returnIn]))[1] : await returnIn;
        } else {
          result = await sql`
            WITH eligible AS (SELECT * FROM reagent_loans WHERE id = ${loanId} AND direction = ${direction} AND status = 'OPEN' AND partner_name = ${partnerName} AND item_id = ${itemId} AND lot_no = ${lotNo} AND quantity - returned_qty >= ${qty}${andDept(scope)}),
            stocked AS (UPDATE inventory SET quantity = quantity - ${qty} WHERE id = (SELECT id FROM inventory WHERE item_id = ${itemId} AND lot_no = ${lotNo} AND quantity >= ${qty}${andDeptWrite(scope)} ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC LIMIT 1) AND EXISTS (SELECT 1 FROM eligible) RETURNING item_id, lot_no),
            logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username${d.column}) SELECT eligible.item_id, eligible.item_name, eligible.lot_no, 'ส่งคืนเจ้าของ', ${qty}, ${actor}${d.value} FROM eligible JOIN stocked ON stocked.item_id = eligible.item_id AND stocked.lot_no = eligible.lot_no)
            UPDATE reagent_loans SET returned_qty = returned_qty + ${qty}, status = CASE WHEN returned_qty + ${qty} = quantity THEN 'CLOSED' ELSE 'OPEN' END, returned_at = CASE WHEN returned_qty + ${qty} = quantity THEN NOW() ELSE returned_at END, updated_by = ${actor}, updated_at = NOW() WHERE id = ${loanId}${andDeptWrite(scope)} AND EXISTS (SELECT 1 FROM logged) RETURNING id
          `;
        }
      }
      if (!result.length) return NextResponse.json({ error: `Unable to record ${itemId}: stock, outstanding balance, or item details no longer match` }, { status: 409 });
    }
    return NextResponse.json({ success: true, message: "บันทึกรายการยืม/คืนสำเร็จ" });
  } catch (error: unknown) {
    if (isDepartmentScopeFailure(error)) return toApiError(error, requestId).response;
    const message = error instanceof Error ? error.message : "Unable to record loan transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
