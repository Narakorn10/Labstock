import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of PATCH /api/users/[username]/account-status with departments OFF (the legacy behavior must not change).

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  schemaReady: true,
  target: null as null | Record<string, unknown>,
  activeAdmins: [{ username: "admin" }, { username: "boss" }] as Array<Record<string, unknown>>,
  approvedVendors: [{ name: "Vendor A" }] as Array<Record<string, unknown>>,
  updateResult: [{ username: "target", accountStatus: "active" }] as Array<Record<string, unknown>>,
  seen: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    h.seen.push(text);
    if (text.includes("information_schema.columns")) return Promise.resolve(h.schemaReady ? [{ column_name: "x" }] : []);
    if (text.includes("WHERE LOWER(username) = LOWER(") && text.includes("SELECT username, role")) return Promise.resolve(h.target ? [h.target] : []);
    if (text.includes("role = 'Admin'") && text.includes("account_status = 'active'")) return Promise.resolve(h.activeAdmins);
    if (text.includes("FROM vendors")) return Promise.resolve(h.approvedVendors);
    if (text.includes("UPDATE users")) return Promise.resolve(h.updateResult);
    throw new Error(`unexpected SQL: ${text}`);
  }) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => ({ unsafe: text });
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({
  getAuthenticatedUser: async () => h.user,
  // Mirrors the real isAdmin so these tests also run against the pre-change route (which imported it).
  isAdmin: async () => h.user?.role === "Admin",
}));

import { PATCH } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

const patch = (body: unknown, username = "target") =>
  PATCH(
    new Request("http://localhost/api/users/target/account-status", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ username }) },
  );

const target = (extra: Row = {}) => ({
  username: "target", role: "User", vendor: null, vendor_request: null, accountStatus: "pending", ...extra,
});

beforeEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  resetDepartmentsFlagForTests();
  h.user = { username: "boss", name: "Boss", role: "Admin" };
  h.schemaReady = true;
  h.target = target();
  h.activeAdmins = [{ username: "admin" }, { username: "boss" }];
  h.approvedVendors = [{ name: "Vendor A" }];
  h.updateResult = [{ username: "target", accountStatus: "active" }];
  h.seen.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH account-status (departments off)", () => {
  it("401 for no user and for a non-Admin, before any SQL", async () => {
    for (const user of [null, { username: "u", role: "User" }, { username: "v", role: "Vendor" }]) {
      h.user = user;
      const response = await patch({ accountStatus: "active" });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
    expect(h.seen).toEqual([]);
  });

  it("503 when the email registration schema is missing", async () => {
    h.schemaReady = false;
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("upgrade_v16_email_auth_registration.sql");
  });

  it("400 for an invalid status", async () => {
    for (const body of [{}, { accountStatus: "pending" }, { accountStatus: 1 }]) {
      const response = await patch(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "สถานะบัญชีไม่ถูกต้อง" });
    }
  });

  it("404 when the target does not exist", async () => {
    h.target = null;
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "ไม่พบบัญชีผู้ใช้" });
  });

  it("400 for the acting admin's own account", async () => {
    h.target = target({ username: "Boss", role: "Admin", accountStatus: "active" });
    const response = await patch({ accountStatus: "suspended" }, "boss");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ไม่สามารถเปลี่ยนสถานะบัญชีของตนเองได้" });
  });

  it("400 for the primary admin", async () => {
    h.target = target({ username: "admin", role: "Admin", accountStatus: "active" });
    const response = await patch({ accountStatus: "suspended" }, "admin");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ไม่สามารถเปลี่ยนสถานะ Admin หลักได้" });
  });

  it("400 when suspending the last active admin", async () => {
    h.target = target({ username: "other", role: "Admin", accountStatus: "active" });
    h.activeAdmins = [{ username: "other" }];
    const response = await patch({ accountStatus: "suspended" }, "other");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ไม่สามารถระงับผู้ดูแลระบบคนสุดท้ายได้" });
  });

  it("400 when activating a vendor without a company (with and without a company request)", async () => {
    h.target = target({ role: "Vendor", vendor: "  ", vendor_request: "New Co" });
    let response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "บัญชี Vendor นี้รอการตรวจสอบและเพิ่มบริษัทที่ร้องขอก่อน จึงจะอนุมัติได้" });
    h.target = target({ role: "Vendor", vendor: null });
    response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "บัญชี Vendor ต้องมีบริษัทที่ได้รับอนุมัติก่อน จึงจะอนุมัติได้" });
  });

  it("400 when the vendor's company is not approved", async () => {
    h.target = target({ role: "Vendor", vendor: "Vendor A" });
    h.approvedVendors = [];
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "บริษัทของ Vendor ยังไม่ได้รับอนุมัติ จึงไม่สามารถเปิดใช้งานบัญชีได้" });
  });

  it("200 and no write when the account already has that status", async () => {
    h.target = target({ accountStatus: "active" });
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: "สถานะบัญชีเป็นสถานะที่เลือกอยู่แล้ว" });
    expect(h.seen.some((text) => text.includes("UPDATE users"))).toBe(false);
  });

  it("200 activating an approved vendor", async () => {
    h.target = target({ role: "Vendor", vendor: "Vendor A" });
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: "อนุมัติบัญชีเรียบร้อยแล้ว", user: { username: "target", accountStatus: "active" } });
  });

  it("200 suspending a user", async () => {
    h.target = target({ accountStatus: "active" });
    h.updateResult = [{ username: "target", accountStatus: "suspended" }];
    const response = await patch({ accountStatus: "suspended" });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe("ระงับบัญชีเรียบร้อยแล้ว");
  });

  it("409 when another admin changed the status first", async () => {
    h.updateResult = [];
    const response = await patch({ accountStatus: "active" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "สถานะบัญชีถูกเปลี่ยนโดยผู้ดูแลคนอื่นแล้ว กรุณารีเฟรชข้อมูล" });
  });

  it("never mentions department tables in the SQL it sends", async () => {
    h.target = target({ role: "Vendor", vendor: "Vendor A" });
    expect((await patch({ accountStatus: "active" })).status).toBe(200);
    expect(h.seen.length).toBeGreaterThan(3);
    expect(h.seen.filter((text) => /department_id|user_departments|departments/i.test(text))).toEqual([]);
  });
});
