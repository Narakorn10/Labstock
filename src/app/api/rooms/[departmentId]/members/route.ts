import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { authorizeRoomRoute } from "@/lib/room-route";

// Members of the caller's own room (see room-route.ts for who may call).
//   GET  list the members
//   POST add a person to the room, or change their role in this room (no confirmation from the person is needed)
//
// user_departments.role is a per-room OVERRIDE: NULL means "use the person's own role". A room admin can only choose
// User / Operator / Manager here; Admin and Vendor are never assignable, and a global Admin or a Vendor cannot be added.
// Only a system Admin can appoint or remove room admins (admin_slot), that is not done here.

type RouteParams = { params: Promise<{ departmentId: string }> };

const ASSIGNABLE_ROLES = new Set(["User", "Operator", "Manager"]);

export const GET = trackRoute<RouteParams>({ action: "room.members.list" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await authorizeRoomRoute(request, ctx, (await params).departmentId, { write: false });
    if (caller instanceof Response) return caller;

    const rows = await sql`
      SELECT u.username, u.name, u.role AS "globalRole", ud.role AS "roomRole", ud.is_default AS "isDefault",
             (ud.admin_slot IS NOT NULL) AS "isRoomAdmin", ud.admin_slot AS "adminSlot", u.account_status AS "accountStatus"
      FROM user_departments ud
      JOIN users u ON u.username = ud.username
      WHERE ud.department_id = ${caller.roomId}
      ORDER BY (ud.admin_slot IS NULL), ud.admin_slot, u.name, u.username
    `;
    return NextResponse.json({ members: rows });
  } catch (error) {
    return ctx.fail(error);
  }
});

export const POST = trackRoute<RouteParams>({ action: "room.members.add" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await authorizeRoomRoute(request, ctx, (await params).departmentId, { write: true });
    if (caller instanceof Response) return caller;

    let body: { username?: unknown; role?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return apiError("INVALID_JSON", { requestId: ctx.requestId });
    }
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const role = body.role === undefined || body.role === null || body.role === "" ? null : body.role;
    if (username.length === 0 || username.length > 80 || (role !== null && (typeof role !== "string" || !ASSIGNABLE_ROLES.has(role)))) {
      return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });
    }
    ctx.details = { attemptedUser: username };

    try {
      // One statement: only an ACTIVE, non-Vendor, non-Admin person can be added, into an active room that has a code.
      // The first room a person ever gets becomes their default room.
      const saved = await sql`
        INSERT INTO user_departments (username, department_id, role, is_default)
        SELECT u.username, d.id, ${role as string | null},
               NOT EXISTS (SELECT 1 FROM user_departments x WHERE x.username = u.username AND x.is_default)
        FROM users u
        JOIN departments d ON d.id = ${caller.roomId} AND d.is_active AND d.code IS NOT NULL
        WHERE LOWER(u.username) = LOWER(${username})
          AND u.account_status = 'active'
          AND u.role NOT IN ('Vendor', 'Admin')
        ON CONFLICT (username, department_id) DO UPDATE SET role = EXCLUDED.role
        RETURNING username, role
      `;
      if (saved.length === 0) return apiError("PENDING_USER_NOT_FOUND", { requestId: ctx.requestId, message: "ไม่พบผู้ใช้ที่เพิ่มเข้าห้องได้", hint: "ผู้ใช้ต้องมีบัญชีที่อนุมัติแล้ว และไม่ใช่ Admin หรือ Vendor" });
      return NextResponse.json({ success: true, member: saved[0] }, { status: 201 });
    } catch (error) {
      // Two people adding the same person to two rooms at once can both try to make it their default room.
      if ((error as { code?: string }).code === "23505") {
        return apiError("DUPLICATE_ENTRY", { requestId: ctx.requestId, message: "มีการแก้ไขสมาชิกพร้อมกัน กรุณาลองใหม่อีกครั้ง" });
      }
      throw error;
    }
  } catch (error) {
    return ctx.fail(error);
  }
});
