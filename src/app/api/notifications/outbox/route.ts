import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { drainNotificationOutbox } from "@/lib/notification-outbox";
import { andDept, departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";

function hasCronSecret(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(configured) && auth === configured;
}

// Returns the signed-in Admin/Manager, or null.
async function getStaffUser(request: Request) {
  const user = await getAuthenticatedUser(request);
  return user?.role === "Admin" || user?.role === "Manager" ? user : null;
}

// The scope is resolved inside the try so a department error (denied / read-only) is answered by departmentErrorResponse.
async function drain(requestId: string, getScope: () => Promise<DepartmentScope>) {
  try {
    const result = await drainNotificationOutbox(50, await getScope());
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Outbox drain failed" }, { status: 500 });
  }
}

// Cron has no user: it drains every department (the cron secret short-circuits before any user lookup).
const cronScope = async (): Promise<DepartmentScope> => ({ mode: "all" });

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  if (hasCronSecret(request)) return drain(requestId, cronScope);
  const user = await getStaffUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return drain(requestId, () => getDepartmentScope(user));
}

export async function GET(request: Request) {
  // Vercel cron always calls GET. With the cron secret, GET delivers the queue (this is what the
  // daily retry relies on); a signed-in Admin/Manager opening it in a browser only gets the status report.
  const requestId = getRequestId(request);
  if (hasCronSecret(request)) return drain(requestId, cronScope);
  const user = await getStaffUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const scope = await getDepartmentScope(user);
    const rows = await sql`
      SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest_created_at,
        MIN(next_attempt_at) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) AS next_attempt_at
      FROM notification_outbox
      WHERE TRUE${andDept(scope)}
      GROUP BY status
      ORDER BY status
    `;
    return NextResponse.json({ items: rows });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    throw error;
  }
}
