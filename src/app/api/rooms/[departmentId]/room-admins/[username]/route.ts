import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { authorizeRoomRoute } from "@/lib/room-route";

// Take away the room admin right of a person in the room the caller is working in. SYSTEM ADMIN ONLY.
// The person stays a member of the room (use the members tools to remove them); only the slot is freed.

type RouteParams = { params: Promise<{ departmentId: string; username: string }> };

export const DELETE = trackRoute<RouteParams>({ action: "room.admin.remove" }, async (request: Request, ctx, { params }) => {
  try {
    const { departmentId, username: rawUsername } = await params;
    const caller = await authorizeRoomRoute(request, ctx, departmentId, { write: true });
    if (caller instanceof Response) return caller;
    if (caller.user.role !== "Admin") return apiError("FORBIDDEN", { requestId: ctx.requestId });

    const username = rawUsername.trim();
    ctx.details = { attemptedUser: username };
    const freed = await sql`
      UPDATE user_departments
      SET admin_slot = NULL
      WHERE department_id = ${caller.roomId}
        AND LOWER(username) = LOWER(${username})
        AND admin_slot IS NOT NULL
      RETURNING username
    `;
    if (freed.length === 0) {
      return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId, message: "ไม่พบผู้ดูแลห้องคนนี้ในห้องนี้", hint: "รีเฟรชรายการ อาจมีการถอดไปแล้ว" });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return ctx.fail(error);
  }
});
