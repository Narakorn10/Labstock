import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { remindOverduePurchaseOrders } from "@/lib/purchase-order-overdue";
import { departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";

// Returns the scope the caller may remind for, or null when not authorized.
//  - valid CRON_SECRET: every department (a worker has no user)
//  - logged-in Admin/Manager: their own scope (a one-department Manager only reminds that department; a central Admin
//    viewing all departments may remind everything, same as the cron)
async function authorize(request: Request): Promise<DepartmentScope | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const requestSecret = request.headers.get("x-cron-secret") || authorization?.replace(/^Bearer\s+/i, "");
  if (cronSecret && requestSecret === cronSecret) return { mode: "all" };

  const user = await getAuthenticatedUser(request);
  if (user?.role !== "Admin" && user?.role !== "Manager") return null;
  return getDepartmentScope(user);
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const scope = await authorize(request);
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const reminded = await remindOverduePurchaseOrders(scope);
    return NextResponse.json({
      success: true,
      reminded: reminded.length,
      orders: reminded.map((order) => ({ po_number: order.po_number, event: order.event_type })),
    });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error("Purchase-order overdue reminder error:", error);
    const message = error instanceof Error ? error.message : "Failed to check overdue purchase orders";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
