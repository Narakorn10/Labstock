import { describe, expect, it, vi } from "vitest";
import { interpretMeResponse } from "./department-switcher-state";
import { ALL_MENUS, SUPER_ADMIN_MENUS, mergeRoomAdminMenus, mergeSuperAdminMenus } from "./menu-config";
import { createAdminRoom, listAdminRooms, updateAdminRoom, type FetchImpl } from "./super-admin-rooms-client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fetchOf(status: number, body: unknown) {
  const impl = vi.fn(async () => json(status, body));
  return { impl: impl as unknown as FetchImpl, calls: () => impl.mock.calls as unknown as Array<[string, RequestInit]> };
}

describe("Super admin menu", () => {
  it("is added only for the Super admin and never mutates the list it is given", () => {
    const base = ["dashboard"];
    expect(mergeSuperAdminMenus(base, true)).toEqual(["dashboard", ...SUPER_ADMIN_MENUS]);
    expect(mergeSuperAdminMenus(base, false)).toBe(base);
    expect(base).toEqual(["dashboard"]);
  });
  it("points at the Super admin page and is not part of the room admin menus", () => {
    const entry = ALL_MENUS.find((item) => item.id === "super_admin_rooms");
    expect(entry?.href).toBe("/super-admin/rooms");
    expect(mergeRoomAdminMenus(["dashboard"], true)).not.toContain("super_admin_rooms");
  });
});

describe("/api/auth/me answer", () => {
  const golden = { success: true, user: { department: "x" } };
  it("passes isSuperAdmin on only when the body says exactly true", () => {
    expect(interpretMeResponse(true, { ...golden, isSuperAdmin: true }).isSuperAdmin).toBe(true);
    for (const value of [false, "true", 1, null, undefined, {}]) {
      expect("isSuperAdmin" in interpretMeResponse(true, { ...golden, isSuperAdmin: value }), String(value)).toBe(false);
    }
  });
  it("never reports it for a failed answer (the user is signed out)", () => {
    expect("isSuperAdmin" in interpretMeResponse(false, { isSuperAdmin: true })).toBe(false);
  });
});

describe("Super admin rooms client", () => {
  it("lists rooms with the session cookie and no Authorization header", async () => {
    const { impl, calls } = fetchOf(200, { rooms: [{ id: 1, name: "CC", code: "CC", isActive: true, memberCount: 3, hasLetterhead: true }] });
    const result = await listAdminRooms(impl);
    expect(result).toMatchObject({ ok: true, data: [{ id: 1, code: "CC" }] });
    const [url, init] = calls()[0];
    expect(url).toBe("/api/super-admin/rooms");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.stringify(init)).not.toMatch(/authorization/i);
  });

  it("creates a room by POSTing the typed name and organization", async () => {
    const { impl, calls } = fetchOf(201, { room: { id: 5, name: "ห้องใหม่" } });
    expect(await createAdminRoom({ name: "ห้องใหม่", organizationName: "รพ." }, impl)).toMatchObject({ ok: true, data: { id: 5 } });
    const [, init] = calls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "ห้องใหม่", organizationName: "รพ." });
  });

  it("PATCHes the room of the id, with the id encoded", async () => {
    const { impl, calls } = fetchOf(200, { room: { id: 7 } });
    await updateAdminRoom(7, { code: "MOL" }, impl);
    expect(calls()[0][0]).toBe("/api/super-admin/rooms/7");
    expect(calls()[0][1].method).toBe("PATCH");
  });

  it("flags the 'confirm before closing' answer so the page can ask, and does not flag other errors", async () => {
    const needs = await updateAdminRoom(2, { isActive: false }, fetchOf(409, { code: "ROOM_RULE_BLOCKED", error: "ยืนยัน", needsConfirmation: true }).impl);
    expect(needs).toMatchObject({ ok: false, needsConfirmation: true });
    const other = await updateAdminRoom(2, { code: "X" }, fetchOf(409, { code: "ROOM_RULE_BLOCKED", error: "ตั้งแล้ว" }).impl);
    expect(other).toMatchObject({ ok: false, needsConfirmation: false });
  });

  it("turns 403 and network failures into errors without throwing", async () => {
    expect(await listAdminRooms(fetchOf(403, { code: "FORBIDDEN", error: "no" }).impl)).toMatchObject({ ok: false });
    const broken = (async () => { throw new Error("offline"); }) as unknown as FetchImpl;
    expect(await listAdminRooms(broken)).toMatchObject({ ok: false, needsConfirmation: false });
  });
});
