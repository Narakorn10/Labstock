import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { departmentsReady } from "@/lib/departments-flag";
import { requireRoomSettingsAccess } from "@/lib/room-admin";

// A room admin (or a system Admin working in that room) approves a person who registered for THIS room.
//
// Deliberately narrow, because the person is not yet trusted:
//  - the room is the one in the caller's own scope; the URL must name that same room (anything else answers 404);
//  - the target must be a pending ordinary 'User' (never Operator / Manager / Admin / Vendor) whose ONLY room is this one;
//  - the whole decision is one UPDATE, so a concurrent change cannot slip between a check and the write;
//  - any miss answers the same 404, so the caller learns nothing about accounts that are not theirs to approve.
// Promoting a role, other rooms, vendors and suspension stay with the system Admin (/api/users/[username]/account-status).

// Same CSRF defence in depth as /api/session/department: a browser POST must come from this very host.
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

// Positive int4 only ("12" or 12); anything else is null.
function parseRoomId(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 2_147_483_647 ? n : null;
}

type RouteParams = { params: Promise<{ departmentId: string; username: string }> };

export const POST = trackRoute<RouteParams>({ action: "room.approve_user" }, async (request: Request, ctx, { params }) => {
  try {
    if (isCrossOrigin(request)) return apiError("FORBIDDEN", { requestId: ctx.requestId });

    const user = await getAuthenticatedUser(request);
    if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
    ctx.user = user;

    if (!await departmentsReady()) return apiError("DEPARTMENTS_DISABLED", { requestId: ctx.requestId });

    const { departmentId: rawRoom, username: rawUsername } = await params;
    const roomId = parseRoomId(rawRoom);
    const username = rawUsername.trim();
    ctx.details = { departmentId: rawRoom, username };

    const access = await requireRoomSettingsAccess(user);
    if (!access.ok) return apiError("FORBIDDEN", { requestId: ctx.requestId });
    if (roomId === null || access.departmentId !== roomId) return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId });
    if (username.length === 0 || username.length > 80 || username.toLowerCase() === user.username.toLowerCase()) {
      return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId });
    }

    const approved = await sql`
      UPDATE users u
      SET account_status = 'active'
      WHERE LOWER(u.username) = LOWER(${username})
        AND u.account_status = 'pending'
        AND u.role = 'User'
        AND EXISTS (
          SELECT 1
          FROM user_departments ud
          JOIN departments d ON d.id = ud.department_id
          WHERE ud.username = u.username AND ud.department_id = ${roomId} AND d.is_active AND d.code IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_departments other WHERE other.username = u.username AND other.department_id <> ${roomId}
        )
      RETURNING u.username
    `;
    if (approved.length === 0) return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId });

    return NextResponse.json({ success: true, message: "อนุมัติบัญชีเรียบร้อยแล้ว", username: String(approved[0].username) });
  } catch (error) {
    return ctx.fail(error);
  }
});
