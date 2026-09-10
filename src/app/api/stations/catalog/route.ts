import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedStation } from "@/lib/station-auth";
import { loadRuntimeBarcodePatterns } from '@/lib/barcode-runtime';

export async function GET(request: Request) {
  try {
    const station = await getAuthenticatedStation(request);
    if (!station) return NextResponse.json({ error: "Unauthorized station." }, { status: 401 });

    const [reagents, runtimePatterns] = await Promise.all([
      sql`
        SELECT item_id as "itemId", barcode as "qrCode", name, unit
        FROM master_data
        WHERE is_active = TRUE
        ORDER BY item_id ASC
      `,
      loadRuntimeBarcodePatterns(),
    ]);

    return NextResponse.json({
      reagents,
      // Keep the legacy field and shape for old agents. New agents consume v2Patterns.
      patterns: runtimePatterns.patterns.map((pattern) => ({
        id: pattern.id,
        name: pattern.name,
        regexPattern: pattern.regex_pattern,
        itemIdGroup: pattern.item_id_group,
        lotNoGroup: pattern.lot_no_group,
        expDateGroup: pattern.exp_date_group,
      })),
      v2Patterns: runtimePatterns.v2Patterns,
      engineVersion: runtimePatterns.engineVersion,
      synced_at: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("Station catalog error:", error);
    return NextResponse.json({ error: "Unable to load station catalog." }, { status: 500 });
  }
}
