import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { confirmCountWorkOrder, CountConfirmError } from "@/lib/count-work-orders";

export const POST = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.confirm" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;
    const id = Number((await params).id);
    const body = await request.json() as { allocations?: Array<{ itemId: string; inventoryId: number; qty: number }> };
    const allocations = body.allocations || [];
    ctx.details = { workOrderId: id, count: allocations.length, items: allocations };
    try {
      const result = await confirmCountWorkOrder(user, id, allocations, {
        userAgent: request.headers.get("user-agent") || "Unknown", ipAddress: request.headers.get("x-forwarded-for") || "Unknown",
      });
      ctx.details = { workOrderId: id, count: allocations.length, status: result.status, dispensedCount: result.dispensed.length, failed: result.failed, remainingCount: result.remaining.length };
      return NextResponse.json(result);
    } catch (error) {
      if (!(error instanceof CountConfirmError)) throw error;
      ctx.details = { workOrderId: id, count: allocations.length, dispensedCount: 0, failed: error.failed, remainingCount: error.remaining.length };
      return ctx.fail(error);
    }
  } catch (error) { return ctx.fail(error); }
});
