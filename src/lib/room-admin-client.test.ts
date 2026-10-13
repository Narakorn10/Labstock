import { describe, expect, it, vi } from "vitest";
import {
  approvePending,
  listMembers,
  listPending,
  removeMember,
  roomRoleLabel,
  saveMember,
  type FetchImpl,
} from "./room-admin-client";
import { ALL_MENUS, ROOM_ADMIN_MENUS, mergeRoomAdminMenus } from "./menu-config";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fetchOf(status: number, body: unknown) {
  const impl = vi.fn(async () => json(status, body));
  return { impl: impl as unknown as FetchImpl, calls: () => impl.mock.calls as unknown as Array<[string, RequestInit]> };
}

describe("room admin client calls", () => {
  it("reads members and pending users from the room of the id, with the session cookie and no Authorization header", async () => {
    const members = fetchOf(200, { members: [{ username: "a" }] });
    expect(await listMembers(7, members.impl)).toEqual({ ok: true, data: [{ username: "a" }] });
    const pending = fetchOf(200, { pending: [{ username: "p" }] });
    expect(await listPending(7, pending.impl)).toEqual({ ok: true, data: [{ username: "p" }] });
    expect(members.calls()[0][0]).toBe("/api/rooms/7/members");
    expect(pending.calls()[0][0]).toBe("/api/rooms/7/pending-users");
    for (const [, init] of [...members.calls(), ...pending.calls()]) {
      expect(init.method).toBe("GET");
      expect(init.credentials).toBe("same-origin");
      expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
    }
  });

  it("an unusable success body gives empty lists, not a crash", async () => {
    expect(await listMembers(1, fetchOf(200, null).impl)).toEqual({ ok: true, data: [] });
    expect(await listPending(1, fetchOf(200, { pending: "x" }).impl)).toMatchObject({ ok: true });
  });

  it("approve: POST to the person's approve URL, username encoded", async () => {
    const f = fetchOf(200, { success: true });
    expect(await approvePending(3, "a b/c", f.impl)).toEqual({ ok: true, data: true });
    expect(f.calls()[0][0]).toBe("/api/rooms/3/pending-users/a%20b%2Fc/approve");
    expect(f.calls()[0][1].method).toBe("POST");
  });

  it("save: POST members with { username, role } (role null = person's own role)", async () => {
    const f = fetchOf(201, { success: true });
    await saveMember(3, "solo1", "Manager", f.impl);
    await saveMember(3, "solo1", null, f.impl);
    expect(f.calls()[0][0]).toBe("/api/rooms/3/members");
    expect(JSON.parse(String(f.calls()[0][1].body))).toEqual({ username: "solo1", role: "Manager" });
    expect(JSON.parse(String(f.calls()[1][1].body))).toEqual({ username: "solo1", role: null });
    expect(f.calls()[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("remove: DELETE members/[username]", async () => {
    const f = fetchOf(200, { success: true });
    await removeMember(3, "solo1", f.impl);
    expect(f.calls()[0][0]).toBe("/api/rooms/3/members/solo1");
    expect(f.calls()[0][1].method).toBe("DELETE");
    expect(f.calls()[0][1].body).toBeUndefined();
  });

  it("an API error becomes the Thai message, hint, code, request id and status", async () => {
    const f = fetchOf(404, { error: "ไม่พบ", code: "PENDING_USER_NOT_FOUND", hint: "รีเฟรช", requestId: "r1" });
    const result = await approvePending(3, "x", f.impl);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ message: "ไม่พบ", code: "PENDING_USER_NOT_FOUND", hint: "รีเฟรช", requestId: "r1", status: 404 }) });
  });

  it("403 keeps its status so the page can show 'no rights'", async () => {
    const result = await listMembers(3, fetchOf(403, { error: "x", code: "FORBIDDEN" }).impl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(403);
  });

  it("a network failure never throws", async () => {
    const failing: FetchImpl = async () => {
      throw new TypeError("offline");
    };
    const result = await removeMember(3, "x", failing);
    expect(result.ok).toBe(false);
  });
});

describe("roomRoleLabel", () => {
  it("shows the room role when set, else the person's own role; Admin and Vendor are never overridden", () => {
    expect(roomRoleLabel({ globalRole: "User", roomRole: "Manager" })).toBe("หัวหน้างาน");
    expect(roomRoleLabel({ globalRole: "Operator", roomRole: null })).toBe("นักเทคนิคการแพทย์");
    expect(roomRoleLabel({ globalRole: "Admin", roomRole: "User" })).toBe("ผู้ดูแลระบบ");
    expect(roomRoleLabel({ globalRole: "Vendor", roomRole: "Manager" })).toBe("บริษัทคู่ค้า");
  });
});

describe("room admin menu", () => {
  it("room_admin is a real menu with a unique id and href", () => {
    const item = ALL_MENUS.find((menu) => menu.id === "room_admin");
    expect(item?.href).toBe("/settings/room");
    expect(new Set(ALL_MENUS.map((menu) => menu.id)).size).toBe(ALL_MENUS.length);
    expect(new Set(ALL_MENUS.map((menu) => menu.href)).size).toBe(ALL_MENUS.length);
    for (const id of ROOM_ADMIN_MENUS) expect(ALL_MENUS.some((menu) => menu.id === id), id).toBe(true);
  });

  it("room admins get the extra menus; everyone else gets the same list back (nothing is stored)", () => {
    const base = ["dashboard"];
    expect(mergeRoomAdminMenus(base, true)).toEqual(["dashboard", ...ROOM_ADMIN_MENUS]);
    expect(mergeRoomAdminMenus(base, false)).toBe(base);
    expect(base).toEqual(["dashboard"]);
  });
});
