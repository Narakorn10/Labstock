import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { confirmCountWorkOrder } from "@/lib/count-work-orders";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as { allocations?: Array<{ itemId: string; inventoryId: number; qty: number }> };
    return NextResponse.json(await confirmCountWorkOrder(user, Number((await params).id), body.allocations || [], {
      userAgent: request.headers.get("user-agent") || "Unknown", ipAddress: request.headers.get("x-forwarded-for") || "Unknown",
    }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
