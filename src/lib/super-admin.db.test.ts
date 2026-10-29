import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";
import type { AuthenticatedUser } from "@/lib/auth-utils";

// Super admin guard against a real (in-memory) Postgres: production schema + v30-v35, with and without v37.

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  signedIn: null as null | { username: string; name: string; role: string },
}));

vi.mock("./db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) =>
    (h.target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values),
}));

vi.mock("@/lib/auth-utils", () => ({
  getAuthenticatedUser: vi.fn(async () => h.signedIn),
}));

import { isSuperAdmin, requireSuperAdmin } from "./super-admin";

let withFlag: PgliteSql;
let withoutFlag: PgliteSql;

const ctx = () => ({ requestId: "req-1", fail: () => new Response(null, { status: 500 }) });
const request = (origin?: string) =>
  new Request("http://localhost/api/super-admin/status", { method: "POST", headers: origin ? { origin, host: "localhost" } : { host: "localhost" } });
const signedIn = (username: string, role = "Admin"): AuthenticatedUser => ({ username, name: username, role });

beforeAll(async () => {
  withFlag = createPgliteSql(new PGlite());
  withoutFlag = createPgliteSql(new PGlite());
  await seedTwoDepartments(withFlag);
  await seedTwoDepartments(withoutFlag);
  await applyMigrationFile(withFlag.db, "upgrade_v37_super_admin.sql");
}, 120_000);

afterAll(async () => {
  await withFlag.db.close();
  await withoutFlag.db.close();
});

beforeEach(async () => {
  h.target = withFlag as unknown as typeof h.target;
  h.signedIn = null;
  await withFlag.db.exec(`
    DELETE FROM users WHERE username IN ('sa', 'plainadmin', 'susp', 'pend', 'mgr', 'vend');
    INSERT INTO users (username, password_hash, name, role, account_status, is_super_admin) VALUES
      ('sa', 'x', 'Super', 'Admin', 'active', true),
      ('plainadmin', 'x', 'Plain', 'Admin', 'active', false),
      ('susp', 'x', 'Suspended', 'Admin', 'suspended', true),
      ('pend', 'x', 'Pending', 'Admin', 'pending', true),
      ('mgr', 'x', 'Manager', 'Manager', 'active', true),
      ('vend', 'x', 'Vendor', 'Vendor', 'active', true);
  `);
});

describe("isSuperAdmin", () => {
  it("true for an active Admin with the flag", async () => {
    expect(await isSuperAdmin("sa")).toBe(true);
  });
  it("false for an Admin without the flag", async () => {
    expect(await isSuperAdmin("plainadmin")).toBe(false);
  });
  it("false when suspended", async () => {
    expect(await isSuperAdmin("susp")).toBe(false);
  });
  it("false when pending", async () => {
    expect(await isSuperAdmin("pend")).toBe(false);
  });
  it("false when role is Manager even with the flag", async () => {
    expect(await isSuperAdmin("mgr")).toBe(false);
  });
  it("false when role is Vendor even with the flag", async () => {
    expect(await isSuperAdmin("vend")).toBe(false);
  });
  it("false for unknown or padded usernames", async () => {
    expect(await isSuperAdmin("nobody")).toBe(false);
    expect(await isSuperAdmin(" sa")).toBe(false);
    expect(await isSuperAdmin("sa ")).toBe(false);
    expect(await isSuperAdmin("SA")).toBe(false);
  });
  it("false (does not throw) when the is_super_admin column is missing", async () => {
    h.target = withoutFlag as unknown as typeof h.target;
    await expect(isSuperAdmin("admin1")).resolves.toBe(false);
  });
});

describe("requireSuperAdmin", () => {
  it("returns 401 when signed out", async () => {
    const result = await requireSuperAdmin(request(), ctx(), { write: false });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
  it("returns 403 for a plain Admin", async () => {
    h.signedIn = signedIn("plainadmin");
    const result = await requireSuperAdmin(request(), ctx(), { write: false });
    expect((result as Response).status).toBe(403);
  });
  it("returns 403 for a cross-origin write even for the Super admin", async () => {
    h.signedIn = signedIn("sa");
    const result = await requireSuperAdmin(request("https://evil.example"), ctx(), { write: true });
    expect((result as Response).status).toBe(403);
  });
  it("returns the user for the Super admin", async () => {
    h.signedIn = signedIn("sa");
    const result = await requireSuperAdmin(request(), ctx(), { write: true });
    expect(result).not.toBeInstanceOf(Response);
    expect((result as AuthenticatedUser).username).toBe("sa");
  });
});
