import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { listPurchaseOrderEvents } from "@/lib/po-communication";
import { departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role === "User" || user.role === "Operator") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const poId = Number(id);
    if (!Number.isInteger(poId)) return NextResponse.json({ error: "Invalid purchase order id" }, { status: 400 });
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    // Lab: only POs of the department being viewed (another department's PO answers 404, not 403). Vendor: NOT filtered by
    // department (same as GET /api/purchase-orders/[id]); the company check inside listPurchaseOrderEvents still applies.
    const scope: DepartmentScope = user.role === "Vendor" ? { mode: "legacy" } : await getDepartmentScope(user);
    const result = await listPurchaseOrderEvents(poId, user, scope, before ? Number(before) : undefined, Number(url.searchParams.get("limit") ?? 50));
    if (result === null) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (result === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error("Error fetching purchase order events:", error);
    return NextResponse.json({ error: "Failed to fetch purchase order events" }, { status: 500 });
  }
}
