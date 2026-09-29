import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { drainNotificationOutbox } from "@/lib/notification-outbox";

function hasCronSecret(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(configured) && auth === configured;
}

async function isStaff(request: Request) {
  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager";
}

async function drain() {
  try {
    const result = await drainNotificationOutbox(50);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Outbox drain failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasCronSecret(request) && !await isStaff(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return drain();
}

export async function GET(request: Request) {
  // Vercel cron always calls GET. With the cron secret, GET delivers the queue (this is what the
  // daily retry relies on); a signed-in Admin/Manager opening it in a browser only gets the status report.
  if (hasCronSecret(request)) return drain();
  if (!await isStaff(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest_created_at,
      MIN(next_attempt_at) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) AS next_attempt_at
    FROM notification_outbox
    GROUP BY status
    ORDER BY status
  `;
  return NextResponse.json({ items: rows });
}
