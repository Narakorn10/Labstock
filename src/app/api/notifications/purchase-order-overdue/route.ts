import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { remindOverduePurchaseOrders } from "@/lib/purchase-order-overdue";

async function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const requestSecret = request.headers.get("x-cron-secret") || authorization?.replace(/^Bearer\s+/i, "");
  if (cronSecret && requestSecret === cronSecret) return true;

  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

export async function POST(request: Request) {
  try {
    if (!await isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reminded = await remindOverduePurchaseOrders();
    return NextResponse.json({
      success: true,
      reminded: reminded.length,
      orders: reminded.map((order) => ({ po_number: order.po_number, event: order.event_type })),
    });
  } catch (error: unknown) {
    console.error("Purchase-order overdue reminder error:", error);
    const message = error instanceof Error ? error.message : "Failed to check overdue purchase orders";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
