import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Super admin room management through the real routes, on the production schema + v30-v37 in memory.

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  signedIn: null as null | { username: string; name: string; role: string },
}));

vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) =>
    (h.target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values),
}));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: vi.fn(async () => h.signedIn) }));

import { GET, POST } from "./route";
import { PATCH } from "./[departmentId]/route";
import { POST as POST_LETTERHEAD } from "./[departmentId]/letterhead/route";

let db: PgliteSql;
let noV36: PgliteSql; // v37 applied but lab_profile still has the old "id = 1" CHECK

const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/super-admin/rooms", {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idParams = (id: string | number) => ({ params: Promise.resolve({ departmentId: String(id) }) });
const patch = (id: string | number, body: unknown) => PATCH(json("PATCH", body), idParams(id));
const letterhead = (id: string | number, body: unknown) => POST_LETTERHEAD(json("POST", body), idParams(id));
const rows = async <T = Record<string, unknown>>(query: string) => (await db.db.query<T>(query)).rows;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  await applyMigrationFile(db.db, "upgrade_v36_lab_profile_per_department.sql");
  await applyMigrationFile(db.db, "upgrade_v37_super_admin.sql");
  noV36 = createPgliteSql(new PGlite());
  await seedTwoDepartments(noV36);
  await applyMigrationFile(noV36.db, "upgrade_v37_super_admin.sql");
}, 180_000);

afterAll(async () => {
  await db.db.close();
  await noV36.db.close();
});

beforeEach(async () => {
  h.target = db as unknown as typeof h.target;
  await db.db.exec(`
    DELETE FROM lab_profile WHERE department_id > 1;
    UPDATE departments SET is_active = true WHERE id IN (1, 2);
    DELETE FROM user_departments WHERE department_id > 2;
    DELETE FROM departments WHERE id > 2;
    DELETE FROM users WHERE username IN ('sa', 'plainadmin');
    INSERT INTO users (username, password_hash, name, role, account_status, is_super_admin) VALUES
      ('sa', 'x', 'Super', 'Admin', 'active', true),
      ('plainadmin', 'x', 'Plain', 'Admin', 'active', false);
  `);
  h.signedIn = { username: "sa", name: "Super", role: "Admin" };
});

async function createRoom(name = "ห้องใหม่", organizationName = "โรงพยาบาลทดสอบ") {
  const response = await POST(json("POST", { name, organizationName }));
  return { response, body: await response.json() as { room?: { id: number } } };
}

describe("access", () => {
  it.each([
    ["signed out", null, 401],
    ["plain Admin", { username: "plainadmin", name: "Plain", role: "Admin" }, 403],
    ["room admin / manager", { username: "mgr", name: "M", role: "Manager" }, 403],
    ["vendor", { username: "vendor1", name: "V", role: "Vendor" }, 403],
  ])("%s gets %i on every route and nothing changes", async (_label, user, status) => {
    h.signedIn = user;
    const before = await rows("SELECT id, name, code, is_active FROM departments ORDER BY id");
    expect((await GET(json("GET"))).status).toBe(status);
    expect((await POST(json("POST", { name: "X room", organizationName: "Org" }))).status).toBe(status);
    expect((await patch(2, { isActive: false, confirmDeactivate: true })).status).toBe(status);
    expect(await rows("SELECT id, name, code, is_active FROM departments ORDER BY id")).toEqual(before);
  });

  it("refuses a cross-origin write even for the Super admin", async () => {
    const request = new Request("http://localhost/api/super-admin/rooms", {
      method: "POST",
      headers: { host: "localhost", origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "Evil", organizationName: "Org" }),
    });
    expect((await POST(request)).status).toBe(403);
  });
});

describe("GET /api/super-admin/rooms", () => {
  it("lists every room with code, state, member count and letterhead flag", async () => {
    const response = await GET(json("GET"));
    expect(response.status).toBe(200);
    const { rooms } = await response.json() as { rooms: Array<{ id: number; code: string | null; isActive: boolean; memberCount: number; hasLetterhead: boolean }> };
    const cc = rooms.find((room) => room.code === "CC");
    expect(cc).toMatchObject({ id: 1, isActive: true, hasLetterhead: true });
    expect(cc?.memberCount).toBeGreaterThan(0);
  });
});

describe("POST /api/super-admin/rooms", () => {
  it("creates a closed room without a code, with its own letterhead and nothing copied from CC", async () => {
    const { response, body } = await createRoom("ห้องโมเลกุล", "รพ. ตัวอย่าง");
    expect(response.status).toBe(201);
    const id = body.room!.id;
    expect(await rows(`SELECT name, code, is_active FROM departments WHERE id = ${id}`)).toEqual([{ name: "ห้องโมเลกุล", code: null, is_active: false }]);
    expect(await rows(`SELECT organization_name, department_name, address, phone, email, logo_url, updated_by FROM lab_profile WHERE department_id = ${id}`)).toEqual([
      { organization_name: "รพ. ตัวอย่าง", department_name: "ห้องโมเลกุล", address: null, phone: null, email: null, logo_url: null, updated_by: "sa" },
    ]);
    // the CC letterhead is untouched
    expect(await rows("SELECT count(*)::int AS n FROM lab_profile WHERE department_id = 1")).toEqual([{ n: 1 }]);
  });

  it("gives each new room its own lab_profile id", async () => {
    await createRoom("ห้องหนึ่ง");
    await createRoom("ห้องสอง");
    const ids = (await rows<{ id: number }>("SELECT id FROM lab_profile ORDER BY id")).map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a missing, blank or too long name / organization", async () => {
    for (const bad of [{}, { name: "x" }, { organizationName: "x" }, { name: " ", organizationName: "x" }, { name: "x".repeat(161), organizationName: "x" }]) {
      expect((await POST(json("POST", bad))).status).toBe(400);
    }
  });

  it("refuses a duplicate name with 409 and leaves no half-made room", async () => {
    await createRoom("ห้องซ้ำ");
    const before = await rows("SELECT count(*)::int AS n FROM lab_profile");
    const again = await createRoom("ห้องซ้ำ");
    expect(again.response.status).toBe(409);
    expect(await rows("SELECT count(*)::int AS n FROM lab_profile")).toEqual(before);
  });

  it("refuses a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/super-admin/rooms", { method: "POST", headers: { host: "localhost" }, body: "{nope" });
    expect((await POST(request)).status).toBe(400);
  });
});

describe("PATCH /api/super-admin/rooms/[id]", () => {
  it("sets the code once (stored upper case) and then opens the room", async () => {
    const { body } = await createRoom();
    const id = body.room!.id;
    expect((await patch(id, { code: "mol" })).status).toBe(200);
    expect(await rows(`SELECT code, is_active FROM departments WHERE id = ${id}`)).toEqual([{ code: "MOL", is_active: false }]);
    expect((await patch(id, { isActive: true })).status).toBe(200);
    expect(await rows(`SELECT is_active FROM departments WHERE id = ${id}`)).toEqual([{ is_active: true }]);
  });

  it("refuses LAB, bad format, CC and a code already used by another room", async () => {
    const { body } = await createRoom();
    const id = body.room!.id;
    for (const bad of ["LAB", "A", "a-b", "CC", "MB"]) {
      const response = await patch(id, { code: bad });
      expect([400, 403, 409]).toContain(response.status);
    }
    expect((await patch(id, { code: "LAB" })).status).toBe(400);
    expect((await patch(id, { code: "MB" })).status).toBe(409);
    expect((await patch(id, { code: "CC" })).status).toBe(403);
    expect(await rows(`SELECT code FROM departments WHERE id = ${id}`)).toEqual([{ code: null }]);
  });

  it("does not let a code be changed once set, but accepts the same code again", async () => {
    const { body } = await createRoom();
    const id = body.room!.id;
    await patch(id, { code: "MOL" });
    expect((await patch(id, { code: "NEW" })).status).toBe(409);
    expect((await patch(id, { code: "MOL" })).status).toBe(200);
    expect(await rows(`SELECT code FROM departments WHERE id = ${id}`)).toEqual([{ code: "MOL" }]);
  });

  it("will not open a room without a code or without a letterhead", async () => {
    const { body } = await createRoom();
    const id = body.room!.id;
    const noCode = await patch(id, { isActive: true });
    expect(noCode.status).toBe(409);
    await patch(id, { code: "MOL" });
    await db.db.exec(`DELETE FROM lab_profile WHERE department_id = ${id}`);
    expect((await patch(id, { isActive: true })).status).toBe(409);
    expect(await rows(`SELECT is_active FROM departments WHERE id = ${id}`)).toEqual([{ is_active: false }]);
  });

  it("renames a room, and refuses a name another room already has", async () => {
    const { body } = await createRoom("ชื่อเดิม");
    const id = body.room!.id;
    expect((await patch(id, { name: "ชื่อใหม่" })).status).toBe(200);
    expect(await rows(`SELECT name FROM departments WHERE id = ${id}`)).toEqual([{ name: "ชื่อใหม่" }]);
    const taken = (await rows<{ name: string }>("SELECT name FROM departments WHERE id = 2"))[0].name;
    expect((await patch(id, { name: taken })).status).toBe(409);
  });

  it("asks for confirmation before closing a room that has members, then closes it", async () => {
    // room 2 (MB) has members in the seed and is not CC
    const first = await patch(2, { isActive: false });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ code: "ROOM_RULE_BLOCKED", needsConfirmation: true });
    expect(await rows("SELECT is_active FROM departments WHERE id = 2")).toEqual([{ is_active: true }]);

    expect((await patch(2, { isActive: false, confirmDeactivate: true })).status).toBe(200);
    expect(await rows("SELECT is_active FROM departments WHERE id = 2")).toEqual([{ is_active: false }]);
    // closing never deletes members or the room
    expect((await rows<{ n: number }>("SELECT count(*)::int AS n FROM user_departments WHERE department_id = 2"))[0].n).toBeGreaterThan(0);
  });

  it("closes an empty room without asking", async () => {
    const { body } = await createRoom();
    const id = body.room!.id;
    await patch(id, { code: "EMP" });
    await patch(id, { isActive: true });
    expect((await patch(id, { isActive: false })).status).toBe(200);
  });

  it("never renames, re-codes or closes CC", async () => {
    for (const change of [{ name: "อื่น" }, { code: "XX" }, { isActive: false, confirmDeactivate: true }]) {
      expect((await patch(1, change)).status).toBe(403);
    }
    expect(await rows("SELECT code, is_active FROM departments WHERE id = 1")).toEqual([{ code: "CC", is_active: true }]);
  });

  it("answers 404 for an unknown or malformed room id and 400 for an empty or wrong-typed change", async () => {
    expect((await patch(9999, { name: "x" })).status).toBe(404);
    for (const bad of ["abc", "0", "-1", "1.5", "99999999999"]) {
      expect((await patch(bad, { name: "x" })).status).toBe(404);
    }
    expect((await patch(2, {})).status).toBe(400);
    expect((await patch(2, { isActive: "yes" })).status).toBe(400);
    expect((await patch(2, { name: 5 })).status).toBe(400);
  });

  it("records who did what in app_events", async () => {
    await db.db.exec("DELETE FROM app_events"); // earlier tests leave rejected (signed-out / non-Super-admin) events behind
    const { body } = await createRoom("บันทึกเหตุการณ์");
    await patch(body.room!.id, { code: "EVT" });
    const events = await rows<{ action: string; username: string }>("SELECT action, username FROM app_events WHERE action LIKE 'super_admin.rooms.%' ORDER BY id");
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["super_admin.rooms.create", "super_admin.rooms.update"]));
    expect(events.every((event) => event.username === "sa")).toBe(true);
  });

  it("a legacy room that is already open cannot get a code until it has a letterhead, but can still be renamed", async () => {
    // rooms made by v30 / Settings: open, no code, no letterhead
    await db.db.exec("INSERT INTO departments (name, is_active) VALUES ('ห้องเดิมเปิดอยู่', true)");
    const id = (await rows<{ id: number }>("SELECT id FROM departments WHERE name = 'ห้องเดิมเปิดอยู่'"))[0].id;
    expect((await patch(id, { name: "ห้องเดิมเปลี่ยนชื่อ" })).status).toBe(200);
    expect((await patch(id, { code: "OLD" })).status).toBe(409);
    expect(await rows(`SELECT code, is_active FROM departments WHERE id = ${id}`)).toEqual([{ code: null, is_active: true }]);
    expect((await letterhead(id, { organizationName: "รพ. เดิม" })).status).toBe(201);
    expect((await patch(id, { code: "OLD" })).status).toBe(200);
    expect(await rows(`SELECT code, is_active FROM departments WHERE id = ${id}`)).toEqual([{ code: "OLD", is_active: true }]);
  });

  it("a legacy room can be closed and then opened again once it has a letterhead", async () => {
    expect((await patch(2, { isActive: false, confirmDeactivate: true })).status).toBe(200);
    expect((await patch(2, { isActive: true })).status).toBe(409); // MB has a code but no letterhead yet
    expect((await letterhead(2, { organizationName: "Molecular Org" })).status).toBe(201);
    expect((await patch(2, { isActive: true })).status).toBe(200);
    expect(await rows("SELECT is_active FROM departments WHERE id = 2")).toEqual([{ is_active: true }]);
  });

  it("a rename and a close sent at the same moment do not undo each other", async () => {
    const { body } = await createRoom("ชื่อเดิมพร้อมกัน");
    const id = body.room!.id;
    await patch(id, { code: "RAC" });
    await patch(id, { isActive: true });
    const [rename, close] = await Promise.all([patch(id, { name: "ชื่อใหม่พร้อมกัน" }), patch(id, { isActive: false })]);
    expect([rename.status, close.status]).toEqual([200, 200]);
    expect(await rows(`SELECT name, is_active FROM departments WHERE id = ${id}`)).toEqual([{ name: "ชื่อใหม่พร้อมกัน", is_active: false }]);
  });
});

describe("POST /api/super-admin/rooms/[id]/letterhead", () => {
  it("creates the letterhead from the typed organization, with the room name as department and nothing from CC", async () => {
    await db.db.exec("INSERT INTO departments (name, is_active) VALUES ('ห้องไม่มีหัวกระดาษ', false)");
    const id = (await rows<{ id: number }>("SELECT id FROM departments WHERE name = 'ห้องไม่มีหัวกระดาษ'"))[0].id;
    expect((await letterhead(id, { organizationName: "องค์กรที่พิมพ์เอง" })).status).toBe(201);
    expect(await rows(`SELECT organization_name, department_name, address, updated_by FROM lab_profile WHERE department_id = ${id}`)).toEqual([
      { organization_name: "องค์กรที่พิมพ์เอง", department_name: "ห้องไม่มีหัวกระดาษ", address: null, updated_by: "sa" },
    ]);
  });

  it("refuses a room that already has one (CC) and never overwrites it", async () => {
    const before = await rows("SELECT organization_name FROM lab_profile WHERE department_id = 1");
    expect((await letterhead(1, { organizationName: "Overwrite" })).status).toBe(409);
    expect(await rows("SELECT organization_name FROM lab_profile WHERE department_id = 1")).toEqual(before);
  });

  it("answers 404 for an unknown room, 400 for a bad name, and refuses non-Super-admins", async () => {
    expect((await letterhead(9999, { organizationName: "x" })).status).toBe(404);
    expect((await letterhead("abc", { organizationName: "x" })).status).toBe(404);
    expect((await letterhead(2, {})).status).toBe(400);
    expect((await letterhead(2, { organizationName: " " })).status).toBe(400);
    h.signedIn = { username: "plainadmin", name: "Plain", role: "Admin" };
    expect((await letterhead(2, { organizationName: "x" })).status).toBe(403);
    h.signedIn = null;
    expect((await letterhead(2, { organizationName: "x" })).status).toBe(401);
  });
});

describe("database without the letterhead migration (v36)", () => {
  it("answers 409 with the missing-migration message (not 500) and leaves no half-made room", async () => {
    h.target = noV36 as unknown as typeof h.target;
    await noV36.db.exec("INSERT INTO users (username, password_hash, name, role, account_status, is_super_admin) VALUES ('sa', 'x', 'Super', 'Admin', 'active', true) ON CONFLICT (username) DO NOTHING");
    const before = (await noV36.db.query<{ n: number }>("SELECT count(*)::int AS n FROM departments")).rows[0].n;
    const response = await POST(json("POST", { name: "ห้องไม่มี v36", organizationName: "รพ." }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ROOM_RULE_BLOCKED", error: expect.stringContaining("migration") });
    expect((await noV36.db.query<{ n: number }>("SELECT count(*)::int AS n FROM departments")).rows[0].n).toBe(before);
  });
});
