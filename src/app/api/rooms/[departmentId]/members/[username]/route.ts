import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { authorizeRoomRoute } from "@/lib/room-route";

// Remove a person from the caller's own room (see room-route.ts for who may call).
//
// Never removes: the caller themself, a room admin (a system Admin does that), or the person's LAST room (they would be
// locked out of the system). Every miss answers the same 404, so nothing is revealed about people outside the room.
//
// Two admins removing the same person from two different rooms at the same time could each see "they still have another
// room" and leave the person with none. The per-person advisory lock is taken in an EARLIER statement of the same
// transaction, so the delete runs on a fresh snapshot and sees the other admin's committed removal.

type RouteParams = { params: Promise<{ departmentId: string; username: string }> };

export const DELETE = trackRoute<RouteParams>({ action: "room.members.remove" }, async (request: Request, ctx, { params }) => {
  try {
    const { departmentId, username: rawUsername } = await params;
    const caller = await authorizeRoomRoute(request, ctx, departmentId, { write: true });
    if (caller instanceof Response) return caller;

    const username = rawUsername.trim();
    ctx.details = { attemptedUser: username };
    if (username.length === 0 || username.length > 80 || username.toLowerCase() === caller.user.username.toLowerCase()) {
      return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId, message: "ไม่พบสมาชิกที่ถอดออกได้" });
    }

    const [, removed] = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_rooms:${username.toLowerCase()}`}, 0))`,
      sql`
        DELETE FROM user_departments ud
        WHERE LOWER(ud.username) = LOWER(${username})
          AND ud.department_id = ${caller.roomId}
          AND ud.admin_slot IS NULL
          AND EXISTS (
            SELECT 1 FROM user_departments other
            WHERE other.username = ud.username AND other.department_id <> ud.department_id
          )
        RETURNING ud.username, ud.is_default
      `,
    ]);
    if (removed.length === 0) {
      return apiError("PENDING_USER_NOT_FOUND", {
        requestId: ctx.requestId,
        message: "ไม่พบสมาชิกที่ถอดออกได้",
        hint: "ถอดไม่ได้ถ้าเป็นผู้ดูแลห้อง หรือเป็นห้องสุดท้ายของผู้ใช้ (ให้ผู้ดูแลระบบจัดการ)",
      });
    }

    // The removed room was the person's default room: make their lowest-numbered remaining room the default.
    // Not atomic with the delete on purpose: a person without a default flag still resolves to a room, and the next
    // "add to room" repairs the flag.
    const row = removed[0] as { username: string; is_default: boolean };
    if (row.is_default) {
      await sql`
        UPDATE user_departments
        SET is_default = true
        WHERE username = ${row.username}
          AND department_id = (SELECT MIN(department_id) FROM user_departments WHERE username = ${row.username})
          AND NOT EXISTS (SELECT 1 FROM user_departments WHERE username = ${row.username} AND is_default)
      `;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return ctx.fail(error);
  }
});
