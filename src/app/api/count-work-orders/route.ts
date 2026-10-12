import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError, toApiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getRequestId } from "@/lib/request-observability";
import { listCountWorkOrders, saveCountWorkOrder } from "@/lib/count-work-orders";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId });
    const response = NextResponse.json(await listCountWorkOrders(user));
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    return toApiError(error, requestId).response;
  }
}

export const POST = trackRoute({ action: "count.save" }, async (request: Request, ctx) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;
    const body = await request.json() as { jobType?: unknown; items?: Array<{ itemId?: unknown; countedQty?: unknown }> };
    ctx.details = { jobType: body.jobType, count: (body.items || []).length, items: body.items };
    const result = await saveCountWorkOrder(user, String(body.jobType || ""), (body.items || []).map((item) => ({
      itemId: String(item.itemId || ""), countedQty: Number(item.countedQty),
    })));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return ctx.fail(error);
  }
});
