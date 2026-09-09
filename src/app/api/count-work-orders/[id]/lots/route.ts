import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getFreshLots } from "@/lib/count-work-orders";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const lots = await getFreshLots(user, Number((await params).id));
    return lots ? NextResponse.json(lots) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 403 }); }
}
