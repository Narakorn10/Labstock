import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";
import { getRequestId } from "@/lib/request-observability";
import { andDept, departmentErrorResponse, getDepartmentScope } from "@/lib/scoped-db";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    // The LINE user's own (default) department; legacy while departments are off.
    const scope = await getDepartmentScope(auth.user);

    const vendors = await sql`
      SELECT vendor, COUNT(*)::int AS item_count
      FROM master_data
      WHERE vendor IS NOT NULL AND TRIM(vendor) <> ''${andDept(scope)}
      GROUP BY vendor
      ORDER BY vendor
    `;

    const orders = await sql`
      SELECT p.*
      FROM purchase_orders p
      WHERE p.status IN ('PENDING_MANAGER_REVIEW', 'SUBMITTED', 'ACKNOWLEDGED', 'PENDING_LAB_REVIEW', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED')${andDept(scope, "p")}
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 30
    `;

    const ordersWithItems = await Promise.all(orders.map(async (po) => ({
      ...po,
      items: await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`,
    })));

    // Departments on: only what the app needs (the scoped user also carries department and role internals). Legacy: unchanged.
    const user = scope.mode === "one"
      ? { username: auth.user.username, name: auth.user.name, role: auth.user.role }
      : auth.user;

    return NextResponse.json({ user, vendors, orders: ordersWithItems });
  } catch (error) {
    console.error("LIFF orders bootstrap error:", error);
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    return NextResponse.json({ error: "Unable to load LINE ordering workspace." }, { status: 500 });
  }
}
