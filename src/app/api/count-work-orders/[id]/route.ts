import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { cancelCountWorkOrder, getCountWorkOrder, saveCountWorkOrder } from "@/lib/count-work-orders";

const parseId = (value: string) => Number(value);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const order = await getCountWorkOrder(user, parseId((await params).id));
    return order ? NextResponse.json(order) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 403 }); }
}

export const PATCH = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.edit" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ctx.user = user;
    const id = parseId((await params).id);
    ctx.details = { workOrderId: id };
    const existing = await getCountWorkOrder(user, id);
    if (!existing || existing.ownerUsername.toLowerCase() !== user.username.toLowerCase() || existing.status !== "OPEN") return NextResponse.json({ error: "Only the owner may edit an open work order" }, { status: 403 });
    const body = await request.json() as { items?: Array<{ itemId?: unknown; countedQty?: unknown }> };
    ctx.details = { workOrderId: id, count: (body.items || []).length, items: body.items };
    const result = await saveCountWorkOrder(user, String(existing.jobType || ""), (body.items || []).map((item) => ({ itemId: String(item.itemId || ""), countedQty: Number(item.countedQty) })));
    if (result.id !== id) return NextResponse.json({ error: "Work order changed while saving" }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
});

export const DELETE = trackRoute<{ params: Promise<{ id: string }> }>({ action: "count.cancel" }, async (request: Request, ctx, { params }) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ctx.user = user;
    const id = parseId((await params).id);
    ctx.details = { workOrderId: id };
    await cancelCountWorkOrder(user, id);
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
});
