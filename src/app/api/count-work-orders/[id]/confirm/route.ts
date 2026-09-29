import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { confirmCountWorkOrder } from "@/lib/count-work-orders";

export const POST = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.confirm" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ctx.user = user;
    const id = Number((await params).id);
    const body = await request.json() as { allocations?: Array<{ itemId: string; inventoryId: number; qty: number }> };
    const allocations = body.allocations || [];
    ctx.details = { workOrderId: id, count: allocations.length, items: allocations };
    return NextResponse.json(await confirmCountWorkOrder(user, id, allocations, {
      userAgent: request.headers.get("user-agent") || "Unknown", ipAddress: request.headers.get("x-forwarded-for") || "Unknown",
    }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
});
