import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { drainNotificationOutbox } from "@/lib/notification-outbox";

async function authorized(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (configured && auth === configured) return true;
  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

export async function POST(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await drainNotificationOutbox(50);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Outbox drain failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest_created_at,
      MIN(next_attempt_at) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) AS next_attempt_at
    FROM notification_outbox
    GROUP BY status
    ORDER BY status
  `;
  return NextResponse.json({ items: rows });
}
