import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { isShelfLifeSchemaMissing, listMinShelfLifeRules } from "@/lib/shelf-life";

// Minimum remaining shelf life per reagent. Lab-only: a Vendor must not relax its own acceptance rule.

const SCHEMA_MISSING = "Minimum shelf-life rules need migration upgrade_v26_min_shelf_life.sql";

async function authorize(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "Admin" && user.role !== "Manager") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ available: true, rules: await listMinShelfLifeRules(sql) });
  } catch (error) {
    if (isShelfLifeSchemaMissing(error)) return NextResponse.json({ available: false, rules: {} });
    console.error("Shelf-life rules error:", error);
    return NextResponse.json({ error: "Unable to load shelf-life rules" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { itemId?: unknown; minShelfLifeDays?: unknown };
    const itemId = String(body.itemId ?? "").trim();
    const raw = body.minShelfLifeDays;
    const days = raw === null || raw === "" || raw === undefined ? null : Number(raw);
    if (!itemId || (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650))) {
      return NextResponse.json({ error: "itemId and a whole number of days between 0 and 3650 (or empty) are required" }, { status: 400 });
    }

    const updated = await sql`
      UPDATE master_data SET min_shelf_life_days = ${days}
      WHERE LOWER(item_id) = LOWER(${itemId})
      RETURNING item_id, min_shelf_life_days
    `;
    if (!updated.length) return NextResponse.json({ error: "Reagent not found" }, { status: 404 });
    return NextResponse.json({ success: true, itemId: updated[0].item_id, minShelfLifeDays: updated[0].min_shelf_life_days });
  } catch (error) {
    if (isShelfLifeSchemaMissing(error)) return NextResponse.json({ error: SCHEMA_MISSING }, { status: 503 });
    console.error("Shelf-life rule update error:", error);
    return NextResponse.json({ error: "Unable to update shelf-life rule" }, { status: 500 });
  }
}
