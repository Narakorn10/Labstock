import { apiError } from "@/lib/api-response";
import type { TrackContext } from "@/lib/app-events";
import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth-utils";
import { departmentsReady } from "@/lib/departments-flag";
import { requireRoomSettingsAccess } from "@/lib/room-admin";

// Shared gate for the /api/rooms/[departmentId]/... routes (room admin tools).
//
// The room is the one in the caller's own scope (never taken from the URL or body); the URL has to name that same room,
// so a room admin can only ever act on their own room. Callers: a room admin of that room, or a system Admin working in it.

// Same CSRF defence in depth as /api/session/department: a browser POST must come from this very host.
export function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Positive int4 only ("12"); anything else is null. */
export function parseRoomParam(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 2_147_483_647 ? n : null;
}

export type RoomCaller = { user: AuthenticatedUser; roomId: number };

/**
 * Checks, in this order: cross-origin (writes only), signed in, departments ready, room-admin rights, URL room = own room.
 * Returns the caller + room, or the error response to send back.
 */
export async function authorizeRoomRoute(
  request: Request,
  ctx: TrackContext,
  rawRoom: string,
  options: { write: boolean },
): Promise<RoomCaller | Response> {
  if (options.write && isCrossOrigin(request)) return apiError("FORBIDDEN", { requestId: ctx.requestId });

  const user = await getAuthenticatedUser(request);
  if (!user) return apiError("AUTH_REQUIRED", { requestId: ctx.requestId });
  ctx.user = user;

  if (!await departmentsReady()) return apiError("DEPARTMENTS_DISABLED", { requestId: ctx.requestId });

  const access = await requireRoomSettingsAccess(user);
  if (!access.ok) return apiError("FORBIDDEN", { requestId: ctx.requestId });

  const roomId = parseRoomParam(rawRoom);
  if (roomId === null || access.departmentId !== roomId) return apiError("DEPARTMENT_NOT_FOUND", { requestId: ctx.requestId });
  return { user, roomId };
}
