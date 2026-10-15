import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// Barcode patterns (V1 list, V2 CRUD / activate / deactivate / validate, runtime loaders, station catalog) per department,
// against a real in-memory Postgres with the production schema + v30-v35.

type Impl = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  target: null as null | ((strings: TemplateStringsArray, ...values: unknown[]) => unknown),
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => (h.target as Impl)(strings, ...values)) as unknown as Record<string, unknown>;
  fn.unsafe = (text: string) => (h.target as unknown as { unsafe: (t: string) => unknown }).unsafe(text);
  fn.transaction = (queries: unknown) => (h.target as unknown as { transaction: (q: unknown) => unknown }).transaction(queries);
  return { default: fn };
});
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: async () => h.user }));
vi.mock("@/lib/barcode-learning-auth", () => ({
  requireBarcodeLearningV2Access: async () =>
    h.user
      ? { response: null, user: h.user }
      : { response: Response.json({ error: "Unauthorized" }, { status: 401 }), user: null },
}));
vi.mock("@/lib/station-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/station-auth")>()),
  getAuthenticatedStation: async () => ({ stationId: "S1", stationName: "Station 1" }),
}));

import { GET as listV2, POST as createV2 } from "./route";
import { DELETE as deleteV2, GET as getV2, PATCH as patchV2 } from "./[id]/route";
import { POST as activateV2 } from "./[id]/activate/route";
import { POST as deactivateV2 } from "./[id]/deactivate/route";
import { POST as validateV2 } from "./validate/route";
import { GET as listV1 } from "../barcodes/route";
import { GET as runtimeRoute } from "../../barcode-patterns/runtime/route";
import { GET as stationCatalog } from "../../stations/catalog/route";
import { loadLegacyPatternsForVerification, loadRuntimeBarcodePatterns } from "@/lib/barcode-runtime";
import type { DepartmentScope } from "@/lib/scoped-db";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
const seenSql: string[] = [];

const as = (username: string, role: string, scope: number | "ALL" | null, extra: Record<string, unknown> = {}) => {
  h.user = { username, name: username, role, scope, ...extra };
};
const url = "http://localhost/api/settings/barcode-v2";
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const json = (method: string, body: unknown) =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rowOf = async (id: number) =>
  (await db.db.query<Record<string, unknown>>("SELECT * FROM barcode_pattern_v2 WHERE id = $1", [id])).rows[0];
const insertPattern = async (name: string, dept: number, status: string, regex: string, examples: unknown[] = [], fixedItemId: string | null = null) =>
  Number(
    (
      await db.db.query<{ id: number }>(
        `INSERT INTO barcode_pattern_v2 (name, status, mapping_mode, fixed_item_id, regex_pattern, item_id_group, examples, created_by, department_id)
         VALUES ($1, $2, $6, $7, $3, $8, $4::jsonb, 'admin1', $5) RETURNING id`,
        [name, status, regex, JSON.stringify(examples), dept, fixedItemId ? "FIXED_REAGENT" : "CAPTURED_IDENTIFIER", fixedItemId, fixedItemId ? null : 1],
      )
    ).rows[0].id,
  );

const bExamples = [{ raw_barcode: "BX1" }, { raw_barcode: "BX2" }];

let aDraft = 0;
let bDraft = 0;
let bVerified = 0;
let bActive = 0;
let aActive = 0;

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
  // The fixture lacks the audit table (upgrade_v19_barcode_learning_v2.sql).
  await db.db.exec(`
    CREATE TABLE IF NOT EXISTS barcode_pattern_v2_audit (
      id BIGSERIAL PRIMARY KEY,
      pattern_id BIGINT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'VALIDATE', 'ACTIVATE', 'DEACTIVATE', 'DELETE')),
      actor TEXT NOT NULL REFERENCES users(username),
      reason TEXT,
      before_json JSONB,
      after_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

beforeEach(async () => {
  seenSql.length = 0;
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    DELETE FROM barcode_pattern_v2_audit;
    DELETE FROM barcode_pattern_v2;
    DELETE FROM barcode_patterns;
    UPDATE departments SET is_active = true WHERE id = ${DEPT_A};
    INSERT INTO barcode_patterns (name, regex_pattern, department_id) VALUES
      ('Legacy A', '^LA(\\d+)$', ${DEPT_A}),
      ('Legacy B', '^LB(\\d+)$', ${DEPT_B});
  `);
  aDraft = await insertPattern("A draft", DEPT_A, "DRAFT", "^AD(\\d+)$");
  aActive = await insertPattern("A active", DEPT_A, "ACTIVE", "^AA(\\d+)$");
  bDraft = await insertPattern("B draft", DEPT_B, "DRAFT", "^BD(\\d+)$");
  bVerified = await insertPattern("B verified", DEPT_B, "VERIFIED", "^BX(\\d+)$", bExamples, "MB-000001");
  bActive = await insertPattern("B active", DEPT_B, "ACTIVE", "^BA(\\d+)$");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET list / detail", () => {
  it("room A lists only its own patterns; room B's id is a 404", async () => {
    as("solo1", "User", DEPT_A);
    const list = (await (await listV2(new Request(url)))!.json()) as Array<{ id: number }>;
    expect(list.map((row) => row.id).sort()).toEqual([aDraft, aActive].sort());
    expect((await getV2(new Request(url), ctx(aDraft)))!.status).toBe(200);
    expect((await getV2(new Request(url), ctx(bDraft)))!.status).toBe(404);
  });

  it("room B lists only its own patterns", async () => {
    as("solo2", "User", DEPT_B);
    const list = (await (await listV2(new Request(url)))!.json()) as Array<{ id: number }>;
    expect(list.map((row) => row.id).sort()).toEqual([bDraft, bVerified, bActive].sort());
  });

  it("Admin viewing ALL rooms reads everything", async () => {
    as("admin1", "Admin", "ALL");
    const list = (await (await listV2(new Request(url)))!.json()) as Array<{ id: number }>;
    expect(list).toHaveLength(5);
    expect((await getV2(new Request(url), ctx(bDraft)))!.status).toBe(200);
  });

  it("a user who asked for a department they are not in gets 404", async () => {
    as("solo1", "User", DEPT_A, { departmentDenied: true });
    expect((await listV2(new Request(url)))!.status).toBe(404);
    expect((await getV2(new Request(url), ctx(aDraft)))!.status).toBe(404);
  });
});

describe("POST create", () => {
  const body = {
    name: "New B pattern",
    mapping_mode: "FIXED_REAGENT",
    fixed_item_id: "MB-000001",
    examples: [{ raw_barcode: "NEW1" }, { raw_barcode: "NEW2" }],
  };

  it("room B's new pattern gets room B's department_id (and an audit row)", async () => {
    as("solo2", "User", DEPT_B);
    const response = await createV2(json("POST", body));
    expect(response!.status).toBe(201);
    const id = Number((await response!.json()).data.pattern.id);
    expect((await rowOf(id)).department_id).toBe(DEPT_B);
    expect((await db.db.query("SELECT 1 FROM barcode_pattern_v2_audit WHERE pattern_id = $1 AND action = 'CREATE'", [id])).rows).toHaveLength(1);
  });

  it("Admin viewing ALL rooms cannot create (409 DEPARTMENT_READ_ONLY) and nothing is written", async () => {
    as("admin1", "Admin", "ALL");
    const response = await createV2(json("POST", body));
    expect(response!.status).toBe(409);
    expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    expect((await db.db.query("SELECT 1 FROM barcode_pattern_v2 WHERE name = 'New B pattern'")).rows).toHaveLength(0);
  });
});

describe("PATCH / DELETE", () => {
  const patchBody = { name: "Renamed", mapping_mode: "CAPTURED_IDENTIFIER", examples: [{ raw_barcode: "R1" }, { raw_barcode: "R2" }] };

  it("room A cannot patch or delete room B's pattern (404) and the row is unchanged", async () => {
    as("solo1", "User", DEPT_A);
    const before = await rowOf(bDraft);
    expect((await patchV2(json("PATCH", patchBody), ctx(bDraft)))!.status).toBe(404);
    expect((await deleteV2(new Request(url, { method: "DELETE" }), ctx(bDraft)))!.status).toBe(404);
    expect(await rowOf(bDraft)).toEqual(before);
    expect(await db.db.query("SELECT 1 FROM barcode_pattern_v2_audit")).toMatchObject({ rows: [] });
  });

  it("room B can patch and delete its own draft", async () => {
    as("solo2", "User", DEPT_B);
    const patched = await patchV2(json("PATCH", patchBody), ctx(bDraft));
    expect(patched!.status).toBe(200);
    expect((await rowOf(bDraft)).name).toBe("Renamed");
    expect((await rowOf(bDraft)).department_id).toBe(DEPT_B);
    expect((await deleteV2(new Request(url, { method: "DELETE" }), ctx(bDraft)))!.status).toBe(200);
    expect(await rowOf(bDraft)).toBeUndefined();
  });

  it("Admin viewing ALL rooms cannot patch or delete (409 DEPARTMENT_READ_ONLY)", async () => {
    as("admin1", "Admin", "ALL");
    const before = await rowOf(bDraft);
    for (const response of [
      await patchV2(json("PATCH", patchBody), ctx(bDraft)),
      await deleteV2(new Request(url, { method: "DELETE" }), ctx(bDraft)),
    ]) {
      expect(response!.status).toBe(409);
      expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    }
    expect(await rowOf(bDraft)).toEqual(before);
  });
});

describe("activate / deactivate", () => {
  it("room A cannot activate or deactivate room B's patterns (404) and the rows are unchanged", async () => {
    as("solo1", "User", DEPT_A);
    const verified = await rowOf(bVerified);
    const active = await rowOf(bActive);
    expect((await activateV2(json("POST", {}), ctx(bVerified)))!.status).toBe(404);
    expect((await deactivateV2(json("POST", { reason: "x" }), ctx(bActive)))!.status).toBe(404);
    expect(await rowOf(bVerified)).toEqual(verified);
    expect(await rowOf(bActive)).toEqual(active);
  });

  it("room B can activate its verified pattern and deactivate its active one", async () => {
    as("solo2", "User", DEPT_B);
    const activated = await activateV2(json("POST", {}), ctx(bVerified));
    expect(activated!.status, JSON.stringify(await activated!.clone().json())).toBe(200);
    expect((await rowOf(bVerified)).status).toBe("ACTIVE");
    expect((await deactivateV2(json("POST", { reason: "retired" }), ctx(bActive)))!.status).toBe(200);
    expect((await rowOf(bActive)).status).toBe("INACTIVE");
    // Room A's own active pattern was never touched.
    expect((await rowOf(aActive)).status).toBe("ACTIVE");
  });

  it("an active pattern in ANOTHER room does not block activation (conflicts are per room)", async () => {
    // Room A's active pattern has a different regex, but its example raw barcode would match room B's candidate regex.
    await db.db.exec(`UPDATE barcode_pattern_v2 SET examples = '[{"raw_barcode":"BX1"}]'::jsonb WHERE id = ${aActive}`);
    as("solo2", "User", DEPT_B);
    const activated = await activateV2(json("POST", {}), ctx(bVerified));
    expect(activated!.status, JSON.stringify(await activated!.clone().json())).toBe(200);
  });

  it("Admin viewing ALL rooms cannot activate or deactivate (409 DEPARTMENT_READ_ONLY)", async () => {
    as("admin1", "Admin", "ALL");
    for (const response of [
      await activateV2(json("POST", {}), ctx(bVerified)),
      await deactivateV2(json("POST", { reason: "x" }), ctx(bActive)),
    ]) {
      expect(response!.status).toBe(409);
      expect((await response!.json()).code).toBe("DEPARTMENT_READ_ONLY");
    }
    expect((await rowOf(bVerified)).status).toBe("VERIFIED");
    expect((await rowOf(bActive)).status).toBe("ACTIVE");
  });
});

describe("validate", () => {
  const fixed = {
    name: "Cross-room fixed",
    mapping_mode: "FIXED_REAGENT",
    fixed_item_id: "MB-000001",
    regex_pattern: "^ZZ(\\d+)$",
    item_id_group: 1,
    examples: [{ raw_barcode: "ZZ1" }, { raw_barcode: "ZZ2" }],
  };
  const validate = async () => {
    const response = await validateV2(json("POST", fixed));
    return (await response!.json()).data.verification as { status: string; errors: string[] };
  };

  it("a fixed_item_id that belongs to another room is unverified; in its own room (or ALL) it is found", async () => {
    as("admin1", "Admin", DEPT_A);
    const fromA = await validate();
    expect(fromA.status).toBe("UNVERIFIED");
    expect(fromA.errors).toContain("ไม่พบ fixed reagent ใน Master Data");

    as("admin1", "Admin", DEPT_B);
    expect((await validate()).errors).not.toContain("ไม่พบ fixed reagent ใน Master Data");
    as("admin1", "Admin", "ALL");
    expect((await validate()).errors).not.toContain("ไม่พบ fixed reagent ใน Master Data");
  });

  it("departmentDenied answers 404", async () => {
    as("admin1", "Admin", DEPT_A, { departmentDenied: true });
    expect((await validateV2(json("POST", fixed)))!.status).toBe(404);
  });
});

describe("runtime loaders and read-only V1 list", () => {
  it("loadRuntimeBarcodePatterns returns only the room's own V1 and active V2 patterns", async () => {
    const a = await loadRuntimeBarcodePatterns({ mode: "one", departmentId: DEPT_A });
    expect(a.patterns.map((p) => p.name)).toEqual(["Legacy A"]);
    expect(a.v2Patterns.map((p) => p.id)).toEqual([aActive]);
    const b = await loadRuntimeBarcodePatterns({ mode: "one", departmentId: DEPT_B });
    expect(b.patterns.map((p) => p.name)).toEqual(["Legacy B"]);
    expect(b.v2Patterns.map((p) => p.id)).toEqual([bActive]);
    const all = await loadRuntimeBarcodePatterns({ mode: "all" });
    expect(all.patterns).toHaveLength(2);
    expect(all.v2Patterns).toHaveLength(2);
    expect((await loadLegacyPatternsForVerification({ mode: "one", departmentId: DEPT_B })).map((p) => p.name)).toEqual(["Legacy B"]);
  });

  it("a wrong argument in the scope slot throws instead of failing open", async () => {
    await expect(loadRuntimeBarcodePatterns(undefined as unknown as DepartmentScope)).rejects.toThrow(/DepartmentScope/);
    await expect(loadRuntimeBarcodePatterns({ username: "solo1" } as unknown as DepartmentScope)).rejects.toThrow(/DepartmentScope/);
    await expect(loadLegacyPatternsForVerification("one" as unknown as DepartmentScope)).rejects.toThrow(/DepartmentScope/);
  });

  it("/api/barcode-patterns/runtime is scoped to the caller's room", async () => {
    as("solo2", "User", DEPT_B);
    const data = await (await runtimeRoute(new Request("http://localhost/api/barcode-patterns/runtime")))!.json();
    expect(data.patterns.map((p: { name: string }) => p.name)).toEqual(["Legacy B"]);
    expect(data.v2Patterns.map((p: { id: number }) => p.id)).toEqual([bActive]);
    as("solo2", "User", DEPT_B, { departmentDenied: true });
    expect((await runtimeRoute(new Request("http://localhost/api/barcode-patterns/runtime")))!.status).toBe(404);
  });

  it("/api/settings/barcodes: a user sees their room; anonymous is 401 once departments are ready", async () => {
    as("solo2", "User", DEPT_B);
    const rows = await (await listV1(new Request("http://localhost/api/settings/barcodes")))!.json();
    expect(rows.map((p: { name: string }) => p.name)).toEqual(["Legacy B"]);
    h.user = null;
    expect((await listV1(new Request("http://localhost/api/settings/barcodes")))!.status).toBe(401);
  });
});

describe("station catalog (all stations = default room CC)", () => {
  const call = () => stationCatalog(new Request("http://localhost/api/stations/catalog"));

  it("serves only room CC's reagents and patterns", async () => {
    await db.db.exec(`UPDATE master_data SET is_active = true`);
    const response = await call();
    expect(response!.status).toBe(200);
    const data = await response!.json();
    const ids = (data.reagents as Array<{ itemId: string }>).map((r) => r.itemId);
    expect(ids).toContain("A-000002");
    expect(ids.some((id) => id.startsWith("MB-"))).toBe(false);
    expect(data.patterns.map((p: { name: string }) => p.name)).toEqual(["Legacy A"]);
    expect(data.v2Patterns.map((p: { id: number }) => p.id)).toEqual([aActive]);
    expect(Object.keys(data).sort()).toEqual(["engineVersion", "patterns", "reagents", "synced_at", "v2Patterns"]);
  });

  it("answers 500 (fail closed) when the default room CC is missing or inactive", async () => {
    await db.db.exec(`UPDATE departments SET is_active = false WHERE id = ${DEPT_A}`);
    expect((await call())!.status).toBe(500);
  });
});

describe("flag OFF (legacy): unchanged and never mentions department_id", () => {
  it("every statement the barcode routes send is free of department_id", async () => {
    delete process.env.DEPARTMENTS_ENABLED;
    const record = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = db(strings, ...values);
        seenSql.push(query.text);
        return query;
      },
      { unsafe: (text: string) => db.unsafe(text), transaction: (queries: never) => db.transaction(queries) },
    );
    h.target = record as unknown as Impl;
    as("admin1", "Admin", null);

    expect((await listV1(new Request("http://localhost/api/settings/barcodes")))!.status).toBe(200);
    h.user = null;
    expect((await listV1(new Request("http://localhost/api/settings/barcodes")))!.status).toBe(200); // anonymous still allowed
    as("admin1", "Admin", null);
    const list = (await (await listV2(new Request(url)))!.json()) as unknown[];
    expect(list).toHaveLength(5);
    expect((await getV2(new Request(url), ctx(bDraft)))!.status).toBe(200);
    const created = await createV2(json("POST", { name: "Legacy new", mapping_mode: "FIXED_REAGENT", fixed_item_id: "A-000002", examples: [{ raw_barcode: "N1" }, { raw_barcode: "N2" }] }));
    expect(created!.status, JSON.stringify(await created!.clone().json())).toBe(201);
    expect((await patchV2(json("PATCH", { name: "Legacy edit", mapping_mode: "CAPTURED_IDENTIFIER", examples: [{ raw_barcode: "E1" }, { raw_barcode: "E2" }] }), ctx(aDraft)))!.status).toBe(200);
    expect((await deleteV2(new Request(url, { method: "DELETE" }), ctx(aDraft)))!.status).toBe(200);
    expect((await activateV2(json("POST", {}), ctx(bVerified)))!.status).toBe(200);
    expect((await deactivateV2(json("POST", { reason: "r" }), ctx(bActive)))!.status).toBe(200);
    expect((await validateV2(json("POST", { name: "v", mapping_mode: "CAPTURED_IDENTIFIER", examples: [{ raw_barcode: "V1" }, { raw_barcode: "V2" }] })))!.status).toBe(200);
    expect((await runtimeRoute(new Request("http://localhost/api/barcode-patterns/runtime")))!.status).toBe(200);
    expect((await stationCatalog(new Request("http://localhost/api/stations/catalog")))!.status).toBe(200);

    expect(seenSql.length).toBeGreaterThan(10);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });
});
