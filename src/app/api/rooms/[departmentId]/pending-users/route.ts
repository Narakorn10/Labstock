import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { authorizeRoomRoute } from "@/lib/room-route";

// People who registered for the caller's own room and wait for approval. Same people the approve route can approve:
// pending ordinary 'User' accounts whose only room is this one. No contact details are returned beyond name and email.

type RouteParams = { params: Promise<{ departmentId: string }> };

export const GET = trackRoute<RouteParams>({ action: "room.pending.list" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await authorizeRoomRoute(request, ctx, (await params).departmentId, { write: false });
    if (caller instanceof Response) return caller;

    const rows = await sql`
      SELECT u.username, u.name, u.email
      FROM users u
      JOIN user_departments ud ON ud.username = u.username AND ud.department_id = ${caller.roomId}
      WHERE u.account_status = 'pending'
        AND u.role = 'User'
        AND NOT EXISTS (SELECT 1 FROM user_departments other WHERE other.username = u.username AND other.department_id <> ${caller.roomId})
      ORDER BY u.username
    `;
    return NextResponse.json({ pending: rows });
  } catch (error) {
    return ctx.fail(error);
  }
});
