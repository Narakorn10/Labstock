import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// authenticateMobileLookup against the real two-department schema: the department comes from the database only.

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  auth: vi.fn(),
}));

vi.mock("./db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) =>
    (h.target as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(strings, ...values),
}));
vi.mock("@/auth", () => ({ auth: h.auth }));

import { resolveDepartmentForVerifiedUser } from "./department-context";
import { resetDepartmentsFlagForTests } from "./departments-flag";
import { authenticateMobileLookup } from "./mobile-lookup-auth";

let migrated: PgliteSql;

function sessionAs(username: string, extra: Record<string, unknown> = {}, role = "User") {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1, ...extra } });
}

const req = () => new Request("http://localhost/api/mobile/lookup");

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  h.target = migrated as unknown as typeof h.target;
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

beforeEach(() => {
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("authenticateMobileLookup with departments enabled", () => {
  it("user1 with activeDepartmentId = DEPT_B still resolves scope DEPT_A", async () => {
    sessionAs("user1", { activeDepartmentId: DEPT_B });
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(true);
    expect(result.ok && result.user).toMatchObject({ username: "user1", scope: 1, departmentId: 1, role: "User" });
  });

  it("admin1 with no membership rows resolves scope 1, not ALL", async () => {
    await migrated.db.exec("DELETE FROM user_departments WHERE username = 'admin1'");
    try {
      sessionAs("admin1", {}, "Admin");
      const result = await authenticateMobileLookup(req());
      expect(result.ok && result.user).toMatchObject({ role: "Admin", scope: 1 });
    } finally {
      await migrated.db.exec("INSERT INTO user_departments (username, department_id, role, is_default) VALUES ('admin1', 1, NULL, true)");
    }
  });

  it("admin1 with activeDepartmentId 'ALL' resolves a numeric scope", async () => {
    sessionAs("admin1", { activeDepartmentId: "ALL" }, "Admin");
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(true);
    expect(result.ok && typeof result.user.scope).toBe("number");
    expect(result.ok && result.user.scope).not.toBe("ALL");
  });

  it("newbie (no membership) is refused", async () => {
    sessionAs("newbie");
    const result = await authenticateMobileLookup(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("scope equals resolveDepartmentForVerifiedUser for solo1, solo2, user1, admin1", async () => {
    for (const username of ["solo1", "solo2", "user1", "admin1"]) {
      sessionAs(username, {}, username === "admin1" ? "Admin" : "User");
      const result = await authenticateMobileLookup(req());
      const expected = await resolveDepartmentForVerifiedUser({ username, name: username, role: "User" });
      expect(result.ok, username).toBe(true);
      expect(result.ok && result.user.scope, username).toBe(expected?.scope);
      expect(typeof expected?.scope).toBe("number");
    }
  });
});
