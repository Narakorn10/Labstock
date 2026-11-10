// Client-side calls for the Super admin room page (/super-admin/rooms). Plain fetch like room-admin-client.ts (NOT axios:
// these routes are cookie-session only, and a failed call must never sign the user out). Nothing here throws.
import { fetchErrorShape, parseApiError, type ApiErrorInfo } from "@/lib/api-errors-client";

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchImpl = (input, init) => fetch(input, init);

export type AdminRoom = {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
  memberCount: number;
  hasLetterhead: boolean;
};

export type RoomsResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo; needsConfirmation: boolean };

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
  init: { method: "GET" | "POST" | "PATCH"; body?: unknown },
  pick: (body: unknown) => T,
  fetchImpl: FetchImpl,
): Promise<RoomsResult<T>> {
  try {
    const response = await fetchImpl(path, {
      method: init.method,
      credentials: "same-origin",
      ...(init.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
    });
    const body = await readJson(response);
    if (response.ok) return { ok: true, data: pick(body) };
    const needsConfirmation = (body as { needsConfirmation?: unknown } | null)?.needsConfirmation === true;
    return { ok: false, error: parseApiError(fetchErrorShape(response.status, body), FALLBACK), needsConfirmation };
  } catch {
    return { ok: false, error: parseApiError({ isAxiosError: true }, FALLBACK), needsConfirmation: false };
  }
}

const roomOf = (body: unknown) => (body as { room: AdminRoom }).room;

export function listAdminRooms(fetchImpl: FetchImpl = defaultFetch) {
  return call("/api/super-admin/rooms", { method: "GET" }, (b) => ((b as { rooms?: AdminRoom[] } | null)?.rooms ?? []), fetchImpl);
}

export function createAdminRoom(input: { name: string; organizationName: string }, fetchImpl: FetchImpl = defaultFetch) {
  return call("/api/super-admin/rooms", { method: "POST", body: input }, roomOf, fetchImpl);
}

export function updateAdminRoom(
  roomId: number,
  change: { name?: string; code?: string; isActive?: boolean; confirmDeactivate?: boolean },
  fetchImpl: FetchImpl = defaultFetch,
) {
  return call(`/api/super-admin/rooms/${encodeURIComponent(String(roomId))}`, { method: "PATCH", body: change }, roomOf, fetchImpl);
}

export function createAdminLetterhead(roomId: number, organizationName: string, fetchImpl: FetchImpl = defaultFetch) {
  return call(`/api/super-admin/rooms/${encodeURIComponent(String(roomId))}/letterhead`, { method: "POST", body: { organizationName } }, roomOf, fetchImpl);
}
