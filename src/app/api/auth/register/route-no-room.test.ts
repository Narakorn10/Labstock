import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Separate file: here the vendor-registry helper is replaced so it answers "company found, but no room" while departments are
// ready (the flag cache flipping between the helper's check and the route's check). The main route.test.ts uses the real helper.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
const h = vi.hoisted(() => ({ target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown) }));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});

vi.mock("@/lib/vendor-registry", () => ({
  listApprovedVendorNames: vi.fn(async () => []),
  findApprovedVendor: vi.fn(async () => ({ name: "MB Vendor", departmentId: null })),
}));

import { POST } from "./route";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let migrated: PgliteSql;

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

beforeEach(() => {
  h.target = migrated as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flag on, company found but without a room id", () => {
  it("answers 503 and creates no user and no membership (never falls back to the default room)", async () => {
    const body = { name: "New Person", email: "noroom@example.com", username: "noroomuser", password: "a-long-password-123", accountType: "vendor", vendorMode: "existing", vendorName: "MB Vendor" };
    const response = await POST(new Request("http://localhost/api/auth/register", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("ไม่สามารถลงทะเบียนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง");
    const users = await migrated.db.query("SELECT 1 FROM users WHERE username = 'noroomuser'");
    const rooms = await migrated.db.query("SELECT 1 FROM user_departments WHERE username = 'noroomuser'");
    expect(users.rows).toEqual([]);
    expect(rooms.rows).toEqual([]);
  });
});
