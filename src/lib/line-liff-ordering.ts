import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";
import { resolveDepartmentForLineUser } from "@/lib/department-context";
import { departmentsReady, isMissingDepartmentSchemaError, markDepartmentsNotReady } from "@/lib/departments-flag";
import { getLineLinkedPurchasingUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";
import { isLabPurchasingRole } from "@/lib/purchase-order-workflow";

export async function getLinePurchasingUserFromRequest(request: Request): Promise<
  | { ok: true; user: AuthenticatedUser; lineUserId: string; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const identity = await verifyLineIdToken(typeof body.idToken === "string" ? body.idToken : "");
  if (!identity) {
    return { ok: false, response: NextResponse.json({ error: "LINE authentication failed." }, { status: 401 }) };
  }

  if (!await hasUserLineIdColumn()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "LINE LIFF ordering is not enabled yet. Run upgrade_v9_line_liff_auth.sql first." }, { status: 400 }),
    };
  }

  let user = await getLineLinkedPurchasingUser(identity.sub);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Only linked Admin or Manager users can order reagents from LINE." }, { status: 403 }) };
  }

  // Departments on: work in the LINE user's own default department. The LINE id token was verified above; the department is
  // never taken from the request, and "all departments" is not possible here. The role in that department can differ from
  // the account role (a per-department override), so it is checked again: a role that cannot order (e.g. User, Vendor) is refused.
  if (await departmentsReady()) {
    let scoped: AuthenticatedUser | null | undefined;
    try {
      scoped = await resolveDepartmentForLineUser(identity.sub, user.username);
    } catch (e) {
      if (!isMissingDepartmentSchemaError(e)) throw e;
      markDepartmentsNotReady("liff ordering lookup failed; using legacy path");
    }
    if (scoped === null) {
      return { ok: false, response: NextResponse.json({ error: "บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ" }, { status: 403 }) };
    }
    if (scoped) {
      if (scoped.globalRole === "Vendor" || !isLabPurchasingRole(scoped.role)) {
        return { ok: false, response: NextResponse.json({ error: "Only linked Admin or Manager users can order reagents from LINE." }, { status: 403 }) };
      }
      user = scoped;
    }
  }

  return { ok: true, user, lineUserId: identity.sub, body };
}

export async function purchaseOrderHasLiffRequestColumn() {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'purchase_orders' AND column_name = 'liff_request_id'
    ) AS exists
  `;

  return Boolean(result[0]?.exists);
}
