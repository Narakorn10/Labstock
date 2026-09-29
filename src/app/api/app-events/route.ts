import { NextResponse } from "next/server";
import { hasMenuPermission } from "@/lib/auth-utils";
import { getRepeatedFailures, listAppEvents, purgeOldAppEvents } from "@/lib/app-events-query";
import type { AppEventsResponse } from "@/lib/app-events-types";

export async function GET(request: Request) {
  try {
    const { user, allowed } = await hasMenuPermission(request, "activity");
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const before = Number(searchParams.get("before"));
    const isFirstPage = !(Number.isInteger(before) && before > 0);

    // Retention runs whenever an admin opens the first page, so no extra cron is needed.
    if (isFirstPage) {
      await purgeOldAppEvents().catch((error) => console.error("[app-events] purge failed:", error));
    }

    const [page, repeated] = await Promise.all([
      listAppEvents({
        username: searchParams.get("username") || undefined,
        action: searchParams.get("action") || undefined,
        outcome: searchParams.get("outcome") || undefined,
        startDate: searchParams.get("startDate") || undefined,
        endDate: searchParams.get("endDate") || undefined,
        before: isFirstPage ? undefined : before,
        limit: Number(searchParams.get("limit")) || undefined,
      }),
      isFirstPage ? getRepeatedFailures() : Promise.resolve([]),
    ]);

    const body: AppEventsResponse = { items: page.items, nextCursor: page.nextCursor, repeated };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error("App events API error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
