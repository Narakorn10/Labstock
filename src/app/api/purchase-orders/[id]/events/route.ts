import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { listPurchaseOrderEvents } from "@/lib/po-communication";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "User" || user.role === "Operator") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const poId = Number(id);
  if (!Number.isInteger(poId)) return NextResponse.json({ error: "Invalid purchase order id" }, { status: 400 });
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const result = await listPurchaseOrderEvents(poId, user, before ? Number(before) : undefined, Number(url.searchParams.get("limit") ?? 50));
  if (result === null) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  if (result === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(result);
}
