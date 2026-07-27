import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedStation } from "@/lib/station-auth";

export async function GET(request: Request) {
  try {
    const station = await getAuthenticatedStation(request);
    if (!station) return NextResponse.json({ error: "Unauthorized station." }, { status: 401 });

    const [reagents, patterns] = await Promise.all([
      sql`
        SELECT item_id as "itemId", barcode as "qrCode", name, unit
        FROM master_data
        ORDER BY item_id ASC
      `,
      sql`
        SELECT id, name, regex_pattern as "regexPattern", item_id_group as "itemIdGroup",
               lot_no_group as "lotNoGroup", exp_date_group as "expDateGroup"
        FROM barcode_patterns
        ORDER BY created_at DESC
      `,
    ]);

    return NextResponse.json({ reagents, patterns, synced_at: new Date().toISOString() });
  } catch (error: unknown) {
    console.error("Station catalog error:", error);
    return NextResponse.json({ error: "Unable to load station catalog." }, { status: 500 });
  }
}
