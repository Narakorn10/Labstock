import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user || (user.role !== "Admin" && user.role !== "Manager")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const rows = await sql`
    UPDATE notification_outbox
    SET status = 'PENDING', attempts = 0, next_attempt_at = NOW(), locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = NOW()
    WHERE id = ${id} AND status IN ('DEAD', 'SKIPPED')
    RETURNING id, status
  `;
  if (!rows.length) return NextResponse.json({ error: "Outbox item not found or is not retryable" }, { status: 404 });
  return NextResponse.json({ success: true, item: rows[0] });
}
