import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { hasMenuPermission } from "@/lib/auth-utils";
import { trackRoute } from "@/lib/app-events";
import { runDispenseBatch } from "@/lib/stock-transactions";

export const POST = trackRoute({ action: "dispense" }, async (request: Request, ctx) => {
  try {
    const { user, allowed } = await hasMenuPermission(request, "dispense");
    ctx.user = user;
    if (!user) {
      return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    }
    if (!allowed) {
      return apiError("FORBIDDEN", { requestId: ctx.requestId });
    }

    const { batchItems } = await request.json();
    ctx.details = { count: Array.isArray(batchItems) ? batchItems.length : undefined, items: batchItems };
    if (!Array.isArray(batchItems) || batchItems.length === 0) {
      return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });
    }
    const userAgent = request.headers.get("user-agent") || "Unknown";
    const ipAddress = request.headers.get("x-forwarded-for") || "Unknown";

    const result = await runDispenseBatch(batchItems, user, { userAgent, ipAddress });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return ctx.fail(error);
  }
});
