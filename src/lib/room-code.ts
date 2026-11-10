// Room (department) code rules. The code is permanent once set: it is tied to data, so changing it later is not offered.
// Rules (owner-approved defaults in docs/superpowers/specs/2026-10-29-super-admin-rooms-design.md):
//   - A-Z and 0-9 only, 2 to 10 characters (typed lower case is accepted and stored upper case)
//   - never "LAB": item ids created before rooms existed all start with "LAB-"
//   - "CC" is the default room and is never created, changed or closed from the screen

export const DEFAULT_ROOM_CODE = "CC";
export const RESERVED_ROOM_CODES: readonly string[] = ["LAB"];
export const ROOM_NAME_MAX = 160;
export const ORGANIZATION_NAME_MAX = 160;

export type RoomCodeCheck = { ok: true; code: string } | { ok: false; reason: "format" | "reserved" };

export function checkRoomCode(input: unknown): RoomCodeCheck {
  if (typeof input !== "string") return { ok: false, reason: "format" };
  const code = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(code)) return { ok: false, reason: "format" };
  if (RESERVED_ROOM_CODES.includes(code)) return { ok: false, reason: "reserved" };
  return { ok: true, code };
}

/** Trimmed, non-empty text of at most `max` characters, or null. Control characters are refused. */
export function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (text.length === 0 || text.length > max) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}
