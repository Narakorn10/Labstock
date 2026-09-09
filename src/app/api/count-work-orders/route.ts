import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { listCountWorkOrders, saveCountWorkOrder } from "@/lib/count-work-orders";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await listCountWorkOrders(user));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as { jobType?: unknown; items?: Array<{ itemId?: unknown; countedQty?: unknown }> };
    const result = await saveCountWorkOrder(user, String(body.jobType || ""), (body.items || []).map((item) => ({
      itemId: String(item.itemId || ""), countedQty: Number(item.countedQty),
    })));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
