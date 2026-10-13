import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { authorizeRoomRoute } from "@/lib/room-route";

// Appoint a room admin ("ผู้ดูแลห้อง") of the room the caller is working in. SYSTEM ADMIN ONLY: a room admin can never
// appoint another (or themselves). A room has at most 2 slots (1, 2); the database enforces that with a partial unique
// index (v35), so two appointments racing for the same free slot cannot both win (the loser gets 409, try again).
//
// Who can be appointed: an ACTIVE ordinary member of this room (not a Vendor, not a global Admin). The slot only adds
// the right to manage THIS room; it does not change anyone's role.

type RouteParams = { params: Promise<{ departmentId: string }> };

export const POST = trackRoute<RouteParams>({ action: "room.admin.appoint" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await authorizeRoomRoute(request, ctx, (await params).departmentId, { write: true });
    if (caller instanceof Response) return caller;
    if (caller.user.role !== "Admin") return apiError("FORBIDDEN", { requestId: ctx.requestId });

    let body: { username?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return apiError("INVALID_JSON", { requestId: ctx.requestId });
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (username.length === 0 || username.length > 80) return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });
    ctx.details = { attemptedUser: username };

    try {
      const appointed = await sql`
        UPDATE user_departments ud
        SET admin_slot = free.slot
        FROM (
          SELECT s.slot
          FROM generate_series(1, 2) AS s(slot)
          WHERE NOT EXISTS (SELECT 1 FROM user_departments x WHERE x.department_id = ${caller.roomId} AND x.admin_slot = s.slot)
          ORDER BY s.slot
          LIMIT 1
        ) free
        WHERE ud.department_id = ${caller.roomId}
          AND LOWER(ud.username) = LOWER(${username})
          AND ud.admin_slot IS NULL
          AND EXISTS (
            SELECT 1 FROM users u
            WHERE u.username = ud.username AND u.account_status = 'active' AND u.role NOT IN ('Vendor', 'Admin')
          )
        RETURNING ud.username, ud.admin_slot AS "adminSlot"
      `;
      if (appointed.length > 0) return NextResponse.json({ success: true, roomAdmin: appointed[0] }, { status: 201 });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return apiError("DUPLICATE_ENTRY", { requestId: ctx.requestId, message: "มีการแต่งตั้งผู้ดูแลห้องพร้อมกัน กรุณาลองใหม่อีกครั้ง" });
      }
      throw error;
    }

    // Nothing changed: tell the Admin (a trusted caller) why.
    const [member, taken] = await Promise.all([
      sql`
        SELECT ud.admin_slot AS "adminSlot", u.account_status AS "accountStatus", u.role
        FROM user_departments ud JOIN users u ON u.username = ud.username
        WHERE ud.department_id = ${caller.roomId} AND LOWER(ud.username) = LOWER(${username})
      `,
      sql`SELECT count(*)::int AS n FROM user_departments WHERE department_id = ${caller.roomId} AND admin_slot IS NOT NULL`,
    ]);
    const row = member[0] as { adminSlot: number | null; accountStatus: string; role: string } | undefined;
    const message = !row
      ? "ผู้ใช้นี้ยังไม่เป็นสมาชิกของห้อง กรุณาเพิ่มเข้าห้องก่อน"
      : row.adminSlot !== null
        ? "ผู้ใช้นี้เป็นผู้ดูแลห้องอยู่แล้ว"
        : row.role === "Vendor" || row.role === "Admin"
          ? "แต่งตั้งบัญชีบริษัทคู่ค้าหรือผู้ดูแลระบบเป็นผู้ดูแลห้องไม่ได้"
          : row.accountStatus !== "active"
            ? "บัญชีนี้ยังไม่ได้อนุมัติหรือถูกระงับ"
            : Number((taken[0] as { n: number }).n) >= 2
              ? "ห้องนี้มีผู้ดูแลห้องครบ 2 คนแล้ว กรุณาถอดคนใดคนหนึ่งก่อน"
              : "แต่งตั้งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    return apiError("VALIDATION_FAILED", { requestId: ctx.requestId, message, status: 409 });
  } catch (error) {
    return ctx.fail(error);
  }
});
