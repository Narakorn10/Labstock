import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyProdSchema, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  texts: [] as string[],
  auth: vi.fn(),
  // "once": only the first schema-probe statement fails; "always": every statement fails; null: nothing is injected.
  failure: null as null | "once" | "always",
  probeFailures: 0,
}));

const PROBE_MARKER = "to_regclass('public.user_departments')";

// Replays the incident: a freshly started instance (never confirmed the schema) whose FIRST readiness probe dies with a
// network-style error (not SQLSTATE 42P01/42703), while the database itself is healthy and fully migrated.
vi.mock("@/lib/db", () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    h.texts.push(text);
    if (h.failure === "always" || (h.failure === "once" && text.includes(PROBE_MARKER) && h.probeFailures === 0)) {
      if (text.includes(PROBE_MARKER)) h.probeFailures++;
      // Lazy like a real query: it only fails when awaited, so a query that is built but never awaited stays silent.
      return { then: (_ok: unknown, onRejected?: (reason: unknown) => unknown) => Promise.reject(new Error("fetch failed")).catch(onRejected) };
    }
    return (h.target as Impl)(strings, ...values);
  },
}));
vi.mock("@/auth", () => ({ auth: h.auth }));

import { getAuthenticatedUser } from "@/lib/auth-utils";
import { departmentsReady, resetDepartmentsFlagForTests } from "@/lib/departments-flag";
import { getDepartmentScope } from "@/lib/scoped-db";

let migrated: PgliteSql;
let premigration: PgliteSql;

function sessionAs(username: string, role = "User") {
  h.auth.mockResolvedValue({ user: { username, name: username, role, vendor: "", sessionVersion: 1 } });
}

const request = () => new Request("http://localhost/api/anything");

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  // Production schema before upgrade_v30: no departments, no user_departments, no department_id columns.
  premigration = createPgliteSql(new PGlite());
  await applyProdSchema(premigration.db);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
  await premigration.db.close();
});

beforeEach(() => {
  h.texts = [];
  h.failure = null;
  h.probeFailures = 0;
  h.auth.mockReset();
  h.auth.mockResolvedValue(null);
  h.target = migrated as unknown as Impl;
  resetDepartmentsFlagForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.DEPARTMENTS_ENABLED = "true";
});

afterEach(() => {
  delete process.env.DEPARTMENTS_ENABLED;
  vi.restoreAllMocks();
});

describe("DEPARTMENTS_ENABLED + first readiness probe fails transiently on an instance that never confirmed the schema", () => {
  it("a member of one department still gets that department's scope (not legacy / unfiltered)", async () => {
    h.failure = "once";
    sessionAs("solo1");
    const user = await getAuthenticatedUser(request());
    expect(h.probeFailures).toBe(1);
    expect(user).toMatchObject({ username: "solo1", scope: 1, departmentId: 1 });
    await expect(getDepartmentScope(user!)).resolves.toEqual({ mode: "one", departmentId: 1 });
  });

  it("a user with no department membership is rejected (null), not let in as a legacy user", async () => {
    h.failure = "once";
    sessionAs("newbie");
    await expect(getAuthenticatedUser(request())).resolves.toBeNull();
    expect(h.probeFailures).toBe(1);
  });

  it("pre-migration schema + flag on + probe fails once: still a legacy user, and readiness drops to false via 42P01", async () => {
    h.target = premigration as unknown as Impl;
    h.failure = "once";
    sessionAs("user1");
    const user = await getAuthenticatedUser(request());
    expect(h.probeFailures).toBe(1);
    expect(user).toEqual({ username: "user1", name: "user1", role: "User", vendor: "" });
    expect(user).not.toHaveProperty("scope");
    await expect(departmentsReady()).resolves.toBe(false);
    await expect(getDepartmentScope(user!)).resolves.toEqual({ mode: "legacy" });
  });

  it("probe AND every other query fail: same result as before the change (no session -> no user, never a legacy user)", async () => {
    h.failure = "always";
    sessionAs("solo1");
    await expect(getAuthenticatedUser(request())).resolves.toBeNull();
  });
});
