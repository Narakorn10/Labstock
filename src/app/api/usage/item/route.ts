import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { clampToToday } from "@/lib/bangkok-date";
import { isDepartmentScopeFailure, toApiError } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-observability";
import { getReagentItemUsage } from "@/lib/reagent-item-usage";
import { isReasonableIsoDate } from "@/lib/local-date";
import { getDepartmentScope } from "@/lib/scoped-db";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "Admin" && user.role !== "Manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const scope = await getDepartmentScope(user);

    const { searchParams } = new URL(request.url);
    const itemId = (searchParams.get("itemId") || "").trim();
    const startDate = (searchParams.get("startDate") || "").trim();
    const requestedEnd = (searchParams.get("endDate") || "").trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    if (!dateRegex.test(startDate) || !dateRegex.test(requestedEnd)) {
      return NextResponse.json({ error: "Invalid date range. Use YYYY-MM-DD" }, { status: 400 });
    }
    if (!isReasonableIsoDate(startDate)) {
      return NextResponse.json({ error: "Invalid date range. Start date must be a real date from the year 2000 on" }, { status: 400 });
    }
    // A day in the future has no usage yet: cut the end to today (Thai time); a start after that is an error.
    const endDate = clampToToday(requestedEnd);
    if (startDate > endDate) {
      return NextResponse.json({ error: "Invalid date range. Use YYYY-MM-DD" }, { status: 400 });
    }

    const detail = await getReagentItemUsage(itemId, startDate, endDate, scope);
    if (!detail) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error: unknown) {
    if (isDepartmentScopeFailure(error)) return toApiError(error, requestId).response;
    console.error("Item Usage API Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
