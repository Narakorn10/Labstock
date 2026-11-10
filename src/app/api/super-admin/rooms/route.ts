import { NextResponse } from "next/server";
import { trackRoute } from "@/lib/app-events";
import { apiError } from "@/lib/api-response";
import { requireSuperAdmin } from "@/lib/super-admin";
import { createRoom, isRoomSchemaNotReady, listRooms } from "@/lib/super-admin-rooms";
import { roomFailureResponse, SCHEMA_MISSING_MESSAGE } from "@/lib/super-admin-rooms-response";

// Super admin only (requireSuperAdmin repeats the database check on every call).
//   GET  all rooms, including closed ones and rooms without a code
//   POST create a room: closed, no code yet, with its own letterhead (organizationName is typed by the Super admin)

export const GET = trackRoute({ action: "super_admin.rooms.list" }, async (request: Request, ctx) => {
  try {
    const caller = await requireSuperAdmin(request, ctx, { write: false });
    if (caller instanceof Response) return caller;
    return NextResponse.json({ rooms: await listRooms() });
  } catch (error) {
    if (isRoomSchemaNotReady(error)) return apiError("ROOM_RULE_BLOCKED", { requestId: ctx.requestId, message: SCHEMA_MISSING_MESSAGE });
    return ctx.fail(error);
  }
});

export const POST = trackRoute({ action: "super_admin.rooms.create" }, async (request: Request, ctx) => {
  try {
    const caller = await requireSuperAdmin(request, ctx, { write: true });
    if (caller instanceof Response) return caller;

    let body: { name?: unknown; organizationName?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      return apiError("INVALID_JSON", { requestId: ctx.requestId });
    }
    const result = await createRoom({ name: body.name, organizationName: body.organizationName }, caller.username);
    if (!result.ok) return roomFailureResponse(result.failure, ctx.requestId);
    ctx.details = { roomId: result.data.id, name: result.data.name };
    return NextResponse.json({ room: result.data }, { status: 201 });
  } catch (error) {
    return ctx.fail(error);
  }
});
