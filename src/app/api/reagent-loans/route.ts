import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";

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

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        AND (${direction}::text = '' OR direction = ${direction})
      ORDER BY loaned_at ASC, id ASC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load outstanding loans";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json() as { operation?: unknown; partnerName?: unknown; batchItems?: LoanItem[] };
    const operation = text(body.operation);
    const partnerName = text(body.partnerName);
    const items = Array.isArray(body.batchItems) ? body.batchItems : [];
    if (!operations.has(operation) || !partnerName || !items.length) {
      return NextResponse.json({ error: "Loan operation, unit, and at least one item are required" }, { status: 400 });
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
        result = await sql`
          WITH master AS (SELECT item_id, name FROM master_data WHERE item_id = ${itemId}),
          stocked AS (INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on)
            SELECT item_id, ${lotNo}, ${expDate}, ${qty}, CURRENT_DATE FROM master
            ON CONFLICT (item_id, lot_no, received_on) DO UPDATE SET quantity = inventory.quantity + ${qty}, exp_date = COALESCE(EXCLUDED.exp_date, inventory.exp_date)
            RETURNING item_id, lot_no),
          logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
            SELECT stocked.item_id, master.name, stocked.lot_no, 'ยืมเข้าคลัง', ${qty}, ${actor} FROM stocked JOIN master ON master.item_id = stocked.item_id)
          INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, exp_date, quantity, created_by)
          SELECT 'BORROWED_IN', ${partnerName}, master.item_id, master.name, ${lotNo}, ${expDate}, ${qty}, ${actor} FROM master
          RETURNING id
        `;
      } else if (operation === "LEND_OUT") {
        result = await sql`
          WITH master AS (SELECT item_id, name FROM master_data WHERE item_id = ${itemId}),
          stocked AS (UPDATE inventory SET quantity = quantity - ${qty}
            WHERE id = (SELECT id FROM inventory WHERE item_id = ${itemId} AND lot_no = ${lotNo} AND quantity >= ${qty} ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC LIMIT 1)
            RETURNING item_id, lot_no),
          logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username)
            SELECT stocked.item_id, master.name, stocked.lot_no, 'ให้ยืมออก', ${qty}, ${actor} FROM stocked JOIN master ON master.item_id = stocked.item_id)
          INSERT INTO reagent_loans (direction, partner_name, item_id, item_name, lot_no, exp_date, quantity, created_by)
          SELECT 'LENT_OUT', ${partnerName}, master.item_id, master.name, ${lotNo}, ${expDate}, ${qty}, ${actor} FROM master WHERE EXISTS (SELECT 1 FROM stocked)
          RETURNING id
        `;
      } else {
        const direction = operation === "RETURN_IN" ? "LENT_OUT" : "BORROWED_IN";
        const receive = operation === "RETURN_IN";
        if (!Number.isInteger(loanId) || loanId <= 0) return NextResponse.json({ error: "Select an outstanding loan before recording a return" }, { status: 400 });
        result = receive
          ? await sql`
            WITH eligible AS (SELECT * FROM reagent_loans WHERE id = ${loanId} AND direction = ${direction} AND status = 'OPEN' AND partner_name = ${partnerName} AND item_id = ${itemId} AND lot_no = ${lotNo} AND quantity - returned_qty >= ${qty}),
            stocked AS (INSERT INTO inventory (item_id, lot_no, exp_date, quantity, received_on) SELECT item_id, lot_no, exp_date, ${qty}, CURRENT_DATE FROM eligible ON CONFLICT (item_id, lot_no, received_on) DO UPDATE SET quantity = inventory.quantity + ${qty} RETURNING item_id, lot_no),
            logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username) SELECT eligible.item_id, eligible.item_name, eligible.lot_no, 'รับคืนจากผู้ยืม', ${qty}, ${actor} FROM eligible JOIN stocked ON stocked.item_id = eligible.item_id AND stocked.lot_no = eligible.lot_no)
            UPDATE reagent_loans SET returned_qty = returned_qty + ${qty}, status = CASE WHEN returned_qty + ${qty} = quantity THEN 'CLOSED' ELSE 'OPEN' END, returned_at = CASE WHEN returned_qty + ${qty} = quantity THEN NOW() ELSE returned_at END, updated_by = ${actor}, updated_at = NOW() WHERE id = ${loanId} AND EXISTS (SELECT 1 FROM logged) RETURNING id
          `
          : await sql`
            WITH eligible AS (SELECT * FROM reagent_loans WHERE id = ${loanId} AND direction = ${direction} AND status = 'OPEN' AND partner_name = ${partnerName} AND item_id = ${itemId} AND lot_no = ${lotNo} AND quantity - returned_qty >= ${qty}),
            stocked AS (UPDATE inventory SET quantity = quantity - ${qty} WHERE id = (SELECT id FROM inventory WHERE item_id = ${itemId} AND lot_no = ${lotNo} AND quantity >= ${qty} ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC LIMIT 1) AND EXISTS (SELECT 1 FROM eligible) RETURNING item_id, lot_no),
            logged AS (INSERT INTO logs (item_id, name, lot_no, action, quantity, username) SELECT eligible.item_id, eligible.item_name, eligible.lot_no, 'ส่งคืนเจ้าของ', ${qty}, ${actor} FROM eligible JOIN stocked ON stocked.item_id = eligible.item_id AND stocked.lot_no = eligible.lot_no)
            UPDATE reagent_loans SET returned_qty = returned_qty + ${qty}, status = CASE WHEN returned_qty + ${qty} = quantity THEN 'CLOSED' ELSE 'OPEN' END, returned_at = CASE WHEN returned_qty + ${qty} = quantity THEN NOW() ELSE returned_at END, updated_by = ${actor}, updated_at = NOW() WHERE id = ${loanId} AND EXISTS (SELECT 1 FROM logged) RETURNING id
          `;
      }
      if (!result.length) return NextResponse.json({ error: `Unable to record ${itemId}: stock, outstanding balance, or item details no longer match` }, { status: 409 });
    }
    return NextResponse.json({ success: true, message: "บันทึกรายการยืม/คืนสำเร็จ" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to record loan transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
