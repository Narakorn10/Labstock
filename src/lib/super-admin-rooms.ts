import sql from "@/lib/db";
import { isMissingDepartmentSchemaError } from "@/lib/departments-flag";
import { DEFAULT_ROOM_CODE, checkRoomCode, cleanText, ORGANIZATION_NAME_MAX, ROOM_NAME_MAX } from "@/lib/room-code";

// Room management for the Super admin (PR 2). Callers must already have passed requireSuperAdmin.
// Rooms are never deleted, only closed. The default room (code CC) can be neither renamed nor closed nor re-coded.
// Every write is ONE statement, so it is all-or-nothing.

export type RoomRow = {
  id: number;
  name: string;
  code: string | null;
  isActive: boolean;
  memberCount: number;
  hasLetterhead: boolean;
};

export type RoomFailure = "validation" | "duplicate" | "not-found" | "protected" | "code-locked" | "needs-confirmation" | "code-required" | "letterhead-missing" | "letterhead-exists" | "schema-missing";
export type RoomResult<T> = { ok: true; data: T } | { ok: false; failure: RoomFailure };

const fail = (failure: RoomFailure): { ok: false; failure: RoomFailure } => ({ ok: false, failure });

type RawRoom = { id: unknown; name: unknown; code: unknown; is_active: unknown; member_count: unknown; has_letterhead: unknown };

function toRoom(row: RawRoom): RoomRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    code: row.code === null ? null : String(row.code),
    isActive: row.is_active === true,
    memberCount: Number(row.member_count),
    hasLetterhead: row.has_letterhead === true,
  };
}

export async function listRooms(): Promise<RoomRow[]> {
  const rows = await sql`
    SELECT d.id, d.name, d.code, d.is_active,
           (SELECT count(*) FROM user_departments ud WHERE ud.department_id = d.id)::int AS member_count,
           EXISTS (SELECT 1 FROM lab_profile lp WHERE lp.department_id = d.id) AS has_letterhead
    FROM departments d
    ORDER BY d.id
  `;
  return rows.map((row) => toRoom(row as RawRoom));
}

async function getRoom(id: number): Promise<RoomRow | null> {
  const rows = await sql`
    SELECT d.id, d.name, d.code, d.is_active,
           (SELECT count(*) FROM user_departments ud WHERE ud.department_id = d.id)::int AS member_count,
           EXISTS (SELECT 1 FROM lab_profile lp WHERE lp.department_id = d.id) AS has_letterhead
    FROM departments d
    WHERE d.id = ${id}
  `;
  return rows.length > 0 ? toRoom(rows[0] as RawRoom) : null;
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
}

function errorConstraint(error: unknown): string {
  const value = (error as { constraint?: unknown } | null)?.constraint ?? (error as { cause?: { constraint?: unknown } } | null)?.cause?.constraint;
  return typeof value === "string" ? value : "";
}

function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === "23505";
}

/**
 * The database is missing a room migration: a column / table is not there (v30, v31, v35, v36 or v37 not applied), or
 * lab_profile still has the old "id = 1" CHECK (v36 not applied). The screen then says which step is missing instead of a 500.
 */
export function isRoomSchemaNotReady(error: unknown): boolean {
  if (isMissingDepartmentSchemaError(error)) return true;
  return errorCode(error) === "23514" && errorConstraint(error).startsWith("lab_profile");
}

/**
 * Creates a CLOSED room without a code, plus its own letterhead row (lab_profile). Nothing is copied from another room:
 * the organization name is typed by the Super admin; address / phone / email / logo stay empty for the room admin.
 * lab_profile.id is a smallint primary key, so the next free id is taken inside the same statement.
 */
export async function createRoom(input: { name: unknown; organizationName: unknown }, actor: string): Promise<RoomResult<RoomRow>> {
  const name = cleanText(input.name, ROOM_NAME_MAX);
  const organizationName = cleanText(input.organizationName, ORGANIZATION_NAME_MAX);
  if (name === null || organizationName === null) return fail("validation");
  // lab_profile.id is the next free number, taken inside the statement. Two creations at the same moment can pick the same
  // number: the second one hits the primary key and nothing was written, so it simply tries again.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`
        WITH room AS (
          INSERT INTO departments (name, is_active) VALUES (${name}, false) RETURNING id
        ), letterhead AS (
          INSERT INTO lab_profile (id, department_id, organization_name, department_name, updated_by)
          SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM lab_profile), room.id, ${organizationName}, ${name}, ${actor}
          FROM room
          RETURNING department_id
        )
        SELECT id FROM room
      `;
      const created = await getRoom(Number(rows[0].id));
      return created ? { ok: true, data: created } : fail("not-found");
    } catch (error) {
      if (isUniqueViolation(error) && errorConstraint(error) === "lab_profile_pkey" && attempt < 3) continue;
      if (isUniqueViolation(error)) return fail("duplicate");
      if (isRoomSchemaNotReady(error)) return fail("schema-missing");
      throw error;
    }
  }
  return fail("duplicate");
}

export type RoomPatch = { name?: unknown; code?: unknown; isActive?: unknown; confirmDeactivate?: unknown };

/** Rename, set the code (once), or open / close a room. Only the fields present in `patch` are touched. */
export async function updateRoom(id: number, patch: RoomPatch): Promise<RoomResult<RoomRow>> {
  let room: RoomRow | null;
  try {
    room = await getRoom(id);
  } catch (error) {
    if (isRoomSchemaNotReady(error)) return fail("schema-missing");
    throw error;
  }
  if (!room) return fail("not-found");

  const wantsName = patch.name !== undefined;
  const wantsCode = patch.code !== undefined;
  const wantsActive = patch.isActive !== undefined;
  if (!wantsName && !wantsCode && !wantsActive) return fail("validation");

  // The default room is fixed: no rename, no code change, never closed.
  if (room.code === DEFAULT_ROOM_CODE) return fail("protected");

  let name = room.name;
  let code = room.code;
  let isActive = room.isActive;

  if (wantsName) {
    const cleaned = cleanText(patch.name, ROOM_NAME_MAX);
    if (cleaned === null) return fail("validation");
    name = cleaned;
  }
  if (wantsCode) {
    const checked = checkRoomCode(patch.code);
    if (!checked.ok) return fail("validation");
    if (room.code !== null && room.code !== checked.code) return fail("code-locked");
    // A new room may never take the default room's code.
    if (checked.code === DEFAULT_ROOM_CODE) return fail("protected");
    code = checked.code;
  }
  if (wantsActive) {
    if (typeof patch.isActive !== "boolean") return fail("validation");
    // Closing is always allowed (a room with members needs the confirmation); the open-state rules are checked below.
    if (!patch.isActive && room.isActive && room.memberCount > 0 && patch.confirmDeactivate !== true) {
      return fail("needs-confirmation");
    }
    isActive = patch.isActive;
  }
  // A room that ends up OPEN needs a code and a letterhead. Checked on the final state whenever the code or the open
  // state is being changed, so setting a code on a legacy room that is already open cannot leave it open without a
  // letterhead. A plain rename is not blocked by this.
  if (isActive && (wantsCode || wantsActive)) {
    if (code === null) return fail("code-required");
    if (!room.hasLetterhead) return fail("letterhead-missing");
  }

  try {
    // The code guard repeats the "set once" rule at write time, so two quick saves cannot swap a code that was just set.
    // Only the fields that were asked for are written. Rewriting all three from the values read at the start would let a
    // rename in one tab undo a close in another (the other fields keep whatever the database holds right now).
    const updated = await sql`
      UPDATE departments SET
        name = CASE WHEN ${wantsName} THEN ${name} ELSE name END,
        code = CASE WHEN ${wantsCode} THEN ${code} ELSE code END,
        is_active = CASE WHEN ${wantsActive} THEN ${isActive} ELSE is_active END
      WHERE id = ${id} AND code IS NOT DISTINCT FROM ${room.code}
      RETURNING id
    `;
    if (updated.length === 0) return fail("code-locked");
  } catch (error) {
    if (isUniqueViolation(error)) return fail("duplicate");
    if (isRoomSchemaNotReady(error)) return fail("schema-missing");
    throw error;
  }
  const saved = await getRoom(id);
  return saved ? { ok: true, data: saved } : fail("not-found");
}

/**
 * Gives a room that has no letterhead (every room made before this screen existed, except CC) its own lab_profile row.
 * Nothing is copied from another room. A room that already has one is refused, never overwritten.
 */
export async function createLetterhead(id: number, organizationNameInput: unknown, actor: string): Promise<RoomResult<RoomRow>> {
  const organizationName = cleanText(organizationNameInput, ORGANIZATION_NAME_MAX);
  if (organizationName === null) return fail("validation");
  let room: RoomRow | null;
  try {
    room = await getRoom(id);
  } catch (error) {
    if (isRoomSchemaNotReady(error)) return fail("schema-missing");
    throw error;
  }
  if (!room) return fail("not-found");
  if (room.hasLetterhead) return fail("letterhead-exists");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const inserted = await sql`
        INSERT INTO lab_profile (id, department_id, organization_name, department_name, updated_by)
        SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM lab_profile), d.id, ${organizationName}, d.name, ${actor}
        FROM departments d
        WHERE d.id = ${id}
        RETURNING department_id
      `;
      if (inserted.length === 0) return fail("not-found");
      const saved = await getRoom(id);
      return saved ? { ok: true, data: saved } : fail("not-found");
    } catch (error) {
      if (isUniqueViolation(error) && errorConstraint(error) === "lab_profile_pkey" && attempt < 3) continue;
      // lab_profile_department_id_key: someone gave the room a letterhead a moment ago.
      if (isUniqueViolation(error)) return fail("letterhead-exists");
      if (isRoomSchemaNotReady(error)) return fail("schema-missing");
      throw error;
    }
  }
  return fail("letterhead-exists");
}
