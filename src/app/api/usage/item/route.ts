import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getReagentItemUsage } from "@/lib/reagent-item-usage";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "Admin" && user.role !== "Manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const itemId = (searchParams.get("itemId") || "").trim();
    const startDate = (searchParams.get("startDate") || "").trim();
    const endDate = (searchParams.get("endDate") || "").trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate) || startDate > endDate) {
      return NextResponse.json({ error: "Invalid date range. Use YYYY-MM-DD" }, { status: 400 });
    }

    const detail = await getReagentItemUsage(itemId, startDate, endDate);
    if (!detail) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error: unknown) {
    console.error("Item Usage API Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
