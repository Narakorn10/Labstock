import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError, toApiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getRequestId } from "@/lib/request-observability";
import { cancelCountWorkOrder, getCountWorkOrder, saveCountWorkOrder } from "@/lib/count-work-orders";

const parseId = (value: string) => Number(value);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId });
    const order = await getCountWorkOrder(user, parseId((await params).id));
    if (!order) return apiError("COUNT_ORDER_NOT_FOUND", { requestId });
    const response = NextResponse.json(order);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) { return toApiError(error, requestId).response; }
}

export const PATCH = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.edit" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;
    const id = parseId((await params).id);
    ctx.details = { workOrderId: id };
    const existing = await getCountWorkOrder(user, id);
    if (!existing || existing.ownerUsername.toLowerCase() !== user.username.toLowerCase() || existing.status !== "OPEN") return apiError("FORBIDDEN", { requestId: ctx.requestId, message: "แก้ไขได้เฉพาะเจ้าของใบงานที่ยังเปิดอยู่" });
    const body = await request.json() as { items?: Array<{ itemId?: unknown; countedQty?: unknown }> };
    ctx.details = { workOrderId: id, count: (body.items || []).length, items: body.items };
    const result = await saveCountWorkOrder(user, String(existing.jobType || ""), (body.items || []).map((item) => ({ itemId: String(item.itemId || ""), countedQty: Number(item.countedQty) })));
    if (result.id !== id) return apiError("STOCK_CHANGED", { requestId: ctx.requestId, message: "ใบงานมีการเปลี่ยนแปลงระหว่างบันทึก" });
    return NextResponse.json(result);
  } catch (error) { return ctx.fail(error); }
});

export const DELETE = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.cancel" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;
    const id = parseId((await params).id);
    ctx.details = { workOrderId: id };
    await cancelCountWorkOrder(user, id);
    return NextResponse.json({ success: true });
  } catch (error) { return ctx.fail(error); }
});
