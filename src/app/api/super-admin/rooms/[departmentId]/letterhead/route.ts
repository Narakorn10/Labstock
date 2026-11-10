import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { parseRoomParam } from "@/lib/room-route";
import { requireSuperAdmin } from "@/lib/super-admin";
import { createLetterhead } from "@/lib/super-admin-rooms";
import { roomFailureResponse } from "@/lib/super-admin-rooms-response";

// POST gives a room that has no letterhead its own lab_profile row (organizationName typed by the Super admin).
// A room that already has one is refused (409), never overwritten.

type RouteParams = { params: Promise<{ departmentId: string }> };

export const POST = trackRoute<RouteParams>({ action: "super_admin.rooms.letterhead" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await requireSuperAdmin(request, ctx, { write: true });
    if (caller instanceof Response) return caller;

    const roomId = parseRoomParam((await params).departmentId);
    if (roomId === null) return apiError("DEPARTMENT_NOT_FOUND", { requestId: ctx.requestId });

    let body: { organizationName?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return apiError("INVALID_JSON", { requestId: ctx.requestId });
    }
    if (typeof body !== "object" || body === null) return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });

    ctx.details = { roomId };
    const result = await createLetterhead(roomId, body.organizationName, caller.username);
    if (!result.ok) return roomFailureResponse(result.failure, ctx.requestId);
    return NextResponse.json({ room: result.data }, { status: 201 });
  } catch (error) {
    return ctx.fail(error);
  }
});
