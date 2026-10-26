import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getLinePurchasingUserFromRequest } from "@/lib/line-liff-ordering";
import { getPurchaseOrderSuggestions } from "@/lib/purchase-order-suggestions";
import { getRequestId } from "@/lib/request-observability";
import { departmentErrorResponse, getDepartmentScope } from "@/lib/scoped-db";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await getLinePurchasingUserFromRequest(request);
    if (!auth.ok) return auth.response;

    const vendor = String(auth.body.vendor ?? "").trim();
    const keyword = String(auth.body.keyword ?? "").trim();
    const suggestOnly = Boolean(auth.body.suggestOnly ?? true);
    if (!vendor) return NextResponse.json({ error: "Choose a Vendor first." }, { status: 400 });

    // Auto-suggest stays policy-only; a search also finds reagents without an order policy
    // so the Lab can add them manually (they then need a reason).
    const searching = Boolean(keyword) || !suggestOnly;
    // The LINE user's own (default) department; legacy while departments are off.
    const scope = await getDepartmentScope(auth.user);
    const rows = await getPurchaseOrderSuggestions(sql, {
      vendor,
      keyword,
      includeAll: searching,
      includeUnconfigured: searching,
      // Browsing without a keyword must show the whole Vendor catalogue (PCL has 116 reagents);
      // auto-suggest ignores this and evaluates every reagent anyway.
      limit: keyword ? 50 : 300,
    }, scope);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("LIFF catalog search error:", error);
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    return NextResponse.json({ error: "Unable to search reagent catalog." }, { status: 500 });
  }
}
