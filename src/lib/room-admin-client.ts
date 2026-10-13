// Client-side calls for the room admin page (/settings/room). Uses fetch directly, NOT api-client (axios):
// api-client attaches a Bearer token (these routes are cookie-session only and the CSRF check expects a browser
// request) and signs the user out on 401. Nothing here throws, signs out or redirects.
import { fetchErrorShape, parseApiError, type ApiErrorInfo } from "@/lib/api-errors-client";

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchImpl = (input, init) => fetch(input, init);

export const ROOM_ASSIGNABLE_ROLES = ["User", "Operator", "Manager"] as const;
export type RoomAssignableRole = (typeof ROOM_ASSIGNABLE_ROLES)[number];

export type RoomMember = {
  username: string;
  name: string | null;
  globalRole: string;
  roomRole: string | null;
  isDefault: boolean;
  isRoomAdmin: boolean;
  adminSlot: number | null;
  accountStatus: string | null;
};

export type PendingUser = { username: string; name: string | null; email: string | null };

export type RoomResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo };

const FALLBACK = "ทำรายการไม่สำเร็จ";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  pick: (body: unknown) => T,
  fetchImpl: FetchImpl,
): Promise<RoomResult<T>> {
  try {
    const response = await fetchImpl(path, {
      method: init.method,
      credentials: "same-origin",
      ...(init.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
    });
    const body = await readJson(response);
    if (response.ok) return { ok: true, data: pick(body) };
    return { ok: false, error: parseApiError(fetchErrorShape(response.status, body), FALLBACK) };
  } catch {
    return { ok: false, error: parseApiError({ isAxiosError: true }, FALLBACK) };
  }
}

const room = (roomId: number) => `/api/rooms/${encodeURIComponent(String(roomId))}`;

export function listMembers(roomId: number, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/members`, { method: "GET" }, (b) => ((b as { members?: RoomMember[] } | null)?.members ?? []), fetchImpl);
}

export function listPending(roomId: number, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/pending-users`, { method: "GET" }, (b) => ((b as { pending?: PendingUser[] } | null)?.pending ?? []), fetchImpl);
}

export function approvePending(roomId: number, username: string, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/pending-users/${encodeURIComponent(username)}/approve`, { method: "POST" }, () => true as const, fetchImpl);
}

/** Adds the person to the room, or changes their role in it. role null = use their own role. */
export function saveMember(roomId: number, username: string, role: RoomAssignableRole | null, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/members`, { method: "POST", body: { username, role } }, () => true as const, fetchImpl);
}

export function removeMember(roomId: number, username: string, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/members/${encodeURIComponent(username)}`, { method: "DELETE" }, () => true as const, fetchImpl);
}

/** System Admin only: give the person one of the room's 2 room admin slots. */
export function appointRoomAdmin(roomId: number, username: string, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/room-admins`, { method: "POST", body: { username } }, () => true as const, fetchImpl);
}

/** System Admin only: free the person's room admin slot (they stay a member). */
export function removeRoomAdmin(roomId: number, username: string, fetchImpl: FetchImpl = defaultFetch) {
  return call(`${room(roomId)}/room-admins/${encodeURIComponent(username)}`, { method: "DELETE" }, () => true as const, fetchImpl);
}

export const ROLE_LABELS: Record<string, string> = {
  Admin: "ผู้ดูแลระบบ",
  Manager: "หัวหน้างาน",
  Operator: "นักเทคนิคการแพทย์",
  User: "ผู้ช่วยห้องปฏิบัติการ",
  Vendor: "บริษัทคู่ค้า",
};

/** The role the person really has in THIS room: the room override when set, else their own role. */
export function roomRoleLabel(member: Pick<RoomMember, "globalRole" | "roomRole">): string {
  const role = member.globalRole === "Admin" || member.globalRole === "Vendor" ? member.globalRole : (member.roomRole ?? member.globalRole);
  return ROLE_LABELS[role] ?? role;
}

