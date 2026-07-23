import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { AuthenticatedUser } from "@/lib/auth-utils";
import { getLineLinkedPurchasingUser, hasUserLineIdColumn, verifyLineIdToken } from "@/lib/line-liff-auth";

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

  const user = await getLineLinkedPurchasingUser(identity.sub);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Only linked Admin or Manager users can order reagents from LINE." }, { status: 403 }) };
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

export async function generatePONumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const result = await sql`
    SELECT COUNT(*) as count
    FROM purchase_orders
    WHERE po_number LIKE ${`PO-${dateStr}-%`}
  `;
  const count = Number(result[0]?.count ?? 0) + 1;
  return `PO-${dateStr}-${count.toString().padStart(3, "0")}`;
}
