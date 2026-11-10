import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { parseRoomParam } from "@/lib/room-route";
import { requireSuperAdmin } from "@/lib/super-admin";
import { updateRoom, type RoomPatch } from "@/lib/super-admin-rooms";
import { roomFailureResponse } from "@/lib/super-admin-rooms-response";

// PATCH rename, set the code (once) or open / close one room. The room comes from the URL here on purpose:
// a Super admin manages every room, so there is no "own room" to compare with.

type RouteParams = { params: Promise<{ departmentId: string }> };

export const PATCH = trackRoute<RouteParams>({ action: "super_admin.rooms.update" }, async (request: Request, ctx, { params }) => {
  try {
    const caller = await requireSuperAdmin(request, ctx, { write: true });
    if (caller instanceof Response) return caller;

    const roomId = parseRoomParam((await params).departmentId);
    if (roomId === null) return apiError("DEPARTMENT_NOT_FOUND", { requestId: ctx.requestId });

    let body: RoomPatch;
    try {
      body = await request.json() as RoomPatch;
    } catch {
      return apiError("INVALID_JSON", { requestId: ctx.requestId });
    }
    if (typeof body !== "object" || body === null) return apiError("VALIDATION_FAILED", { requestId: ctx.requestId });

    ctx.details = { roomId, fields: Object.keys(body).filter((key) => key !== "confirmDeactivate") };
    const result = await updateRoom(roomId, {
      name: body.name,
      code: body.code,
      isActive: body.isActive,
      confirmDeactivate: body.confirmDeactivate,
    });
    if (!result.ok) return roomFailureResponse(result.failure, ctx.requestId);
    return NextResponse.json({ room: result.data });
  } catch (error) {
    return ctx.fail(error);
  }
});
