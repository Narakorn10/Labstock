import sql from "@/lib/db";

// Rooms (departments) a NEW user can be placed in. Used by self-registration and by Admin user creation, only when
// departments are enabled and ready (the callers check departmentsReady() first; with the flag off nothing here runs).
// A selectable room is active and has a code (v30 gives the default room 'CC'; rooms without a code are not usable yet).

export type SelectableRoom = { id: number; name: string };

export async function listSelectableRooms(): Promise<SelectableRoom[]> {
  const rows = await sql`
    SELECT id, name
    FROM departments
    WHERE is_active AND code IS NOT NULL
    ORDER BY id
  `;
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
}

/** The default room 'CC' (owner of all pre-existing data), or null when it is missing / inactive. */
export async function defaultRoomId(): Promise<number | null> {
  const rows = await sql`SELECT id FROM departments WHERE code = 'CC' AND is_active LIMIT 1`;
  return rows.length > 0 ? Number(rows[0].id) : null;
}

/** Accepts a positive int4 as a number or a numeric string; anything else is null. */
export function parseRoomId(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,10}$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 2_147_483_647 ? n : null;
}
