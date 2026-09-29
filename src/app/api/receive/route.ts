import { NextResponse } from "next/server";
import { hasMenuPermission } from "@/lib/auth-utils";
import { trackRoute } from "@/lib/app-events";
import { runReceiveBatch } from "@/lib/stock-transactions";

export const POST = trackRoute({ action: "receive" }, async (request: Request, ctx) => {
  try {
    const { user, allowed } = await hasMenuPermission(request, "receive");
    ctx.user = user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { batchItems } = await request.json();
    ctx.details = { count: Array.isArray(batchItems) ? batchItems.length : undefined, items: batchItems };
    const userAgent = request.headers.get("user-agent") || "Unknown";
    const ipAddress = request.headers.get("x-forwarded-for") || "Unknown";

    const result = await runReceiveBatch(batchItems, user, { userAgent, ipAddress });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Receive API Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = errorMessage.startsWith('REAGENT_INACTIVE') ? 409 : 500;
    return NextResponse.json({ error: errorMessage }, { status });
  }
});
