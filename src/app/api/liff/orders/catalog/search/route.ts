import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";

export async function POST(request: Request) {
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const vendor = String(auth.body.vendor ?? "").trim();
    const keyword = String(auth.body.keyword ?? "").trim();
    const suggestOnly = Boolean(auth.body.suggestOnly ?? true);
    if (!vendor) return NextResponse.json({ error: "Choose a Vendor first." }, { status: 400 });

    const searchTerm = `%${keyword}%`;
    const rows = keyword
      ? await sql`
        WITH inventory_summary AS (
          SELECT item_id, SUM(quantity) AS current_qty FROM inventory GROUP BY item_id
        )
        SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
          COALESCE(i.current_qty, 0) AS quantity,
          GREATEST(1, (COALESCE(m.weekly_target, 0) * 4) - COALESCE(i.current_qty, 0))::int AS suggested_order_qty
        FROM master_data m
        LEFT JOIN inventory_summary i ON i.item_id = m.item_id
        WHERE m.vendor = ${vendor}
          AND (m.item_id ILIKE ${searchTerm} OR m.name ILIKE ${searchTerm} OR COALESCE(m.barcode, '') ILIKE ${searchTerm})
        ORDER BY COALESCE(i.current_qty, 0), m.name
        LIMIT 30
      `
      : await sql`
        WITH inventory_summary AS (
          SELECT item_id, SUM(quantity) AS current_qty FROM inventory GROUP BY item_id
        )
        SELECT m.item_id, m.name, m.unit, m.vendor, m.min_threshold, m.weekly_target,
          COALESCE(i.current_qty, 0) AS quantity,
          GREATEST(1, (COALESCE(m.weekly_target, 0) * 4) - COALESCE(i.current_qty, 0))::int AS suggested_order_qty
        FROM master_data m
        LEFT JOIN inventory_summary i ON i.item_id = m.item_id
        WHERE m.vendor = ${vendor}
          AND (${suggestOnly} = false OR COALESCE(i.current_qty, 0) <= m.min_threshold)
        ORDER BY COALESCE(i.current_qty, 0), m.name
        LIMIT 30
      `;

    return NextResponse.json(rows);
  } catch (error) {
    console.error("LIFF catalog search error:", error);
    return NextResponse.json({ error: "Unable to search reagent catalog." }, { status: 500 });
  }
}
