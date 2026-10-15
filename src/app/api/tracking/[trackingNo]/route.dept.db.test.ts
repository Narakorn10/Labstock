import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { DEPT_A, DEPT_B, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// GET /api/tracking/[trackingNo] (MANUAL provider reads shipments) per department, against a real in-memory Postgres.

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

import { GET } from "./route";
import { manualProvider } from "@/lib/tracking-providers/manual";
import { resetDepartmentsFlagForTests } from "@/lib/departments-flag";

let db: PgliteSql;
const seenSql: string[] = [];

const as = (username: string, role: string, scope: number | "ALL" | null) => {
  h.user = { username, name: username, role, scope };
};
const track = (trackingNo: string, provider = "MANUAL") =>
  GET(new Request(`http://localhost/api/tracking/${trackingNo}?provider=${provider}`), { params: Promise.resolve({ trackingNo }) });
// The body carries the tracking number and a lastUpdate timestamp; blank the timestamp so two responses can be compared.
const bodyOf = async (response: Response) => {
  const body = (await response.json()) as Record<string, unknown>;
  return { ...body, lastUpdate: "<ts>" };
};

beforeAll(async () => {
  db = createPgliteSql(new PGlite());
  await seedTwoDepartments(db);
}, 120_000);

afterAll(async () => {
  await db.db.close();
});

// Department A shipment TRK-A (PO-TRK-A), department B shipment TRK-B (PO-TRK-B).
beforeEach(async () => {
  seenSql.length = 0;
  h.target = db as unknown as Impl;
  resetDepartmentsFlagForTests();
  process.env.DEPARTMENTS_ENABLED = "true";
  await db.db.exec(`
    DELETE FROM shipments;
    DELETE FROM shipment_batches;
    DELETE FROM purchase_orders WHERE po_number LIKE 'PO-TRK-%';
    INSERT INTO purchase_orders (po_number, vendor, created_by, status, department_id) VALUES
      ('PO-TRK-A', 'Vendor A', 'admin1', 'SHIPPED', ${DEPT_A}),
      ('PO-TRK-B', 'MB Vendor', 'solo2', 'SHIPPED', ${DEPT_B});
    INSERT INTO shipments (vendor, item_id, lot_no, quantity, status, po_number, tracking_no, department_id) VALUES
      ('Vendor A', 'LAB-000001', 'LA1', 1, 'In Transit', 'PO-TRK-A', 'TRK-A', ${DEPT_A}),
      ('MB Vendor', 'MB-000001', 'LB1', 1, 'In Transit', 'PO-TRK-B', 'TRK-B', ${DEPT_B});
  `);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/tracking/[trackingNo] (MANUAL)", () => {
  it("department A sees its own tracking number", async () => {
    as("admin1", "Admin", DEPT_A);
    const response = await track("TRK-A");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ trackingNo: "TRK-A", status: "In Transit" });
  });

  it("department A cannot see B's tracking number: same response as a nonexistent number", async () => {
    as("admin1", "Admin", DEPT_A);
    const other = await track("TRK-B");
    const missing = await track("TRK-DOES-NOT-EXIST");
    expect(other.status).toBe(200);
    expect(missing.status).toBe(200);
    const otherBody = await bodyOf(other);
    expect(otherBody).toMatchObject({ status: "UNKNOWN", statusText: "ไม่พบข้อมูล", history: [] });
    expect({ ...otherBody, trackingNo: "x" }).toEqual({ ...(await bodyOf(missing)), trackingNo: "x" });
  });

  it("department B sees its own and not A's", async () => {
    as("solo2", "User", DEPT_B);
    expect(await (await track("TRK-B")).json()).toMatchObject({ status: "In Transit" });
    expect(await (await track("TRK-A")).json()).toMatchObject({ status: "UNKNOWN" });
  });

  it("Admin viewing ALL departments sees both", async () => {
    as("admin1", "Admin", "ALL");
    expect(await (await track("TRK-A")).json()).toMatchObject({ status: "In Transit" });
    expect(await (await track("TRK-B")).json()).toMatchObject({ status: "In Transit" });
  });

  it("fails closed for a user without a department scope (catalogue 500, no data)", async () => {
    as("newbie", "User", null);
    const response = await track("TRK-A");
    expect(response.status).toBe(500); // DEPARTMENT_SCOPE_MISSING maps to INTERNAL_ERROR by design
    expect(JSON.stringify(await response.json())).not.toContain("TRK-A");
  });

  it("rejects anonymous callers with 401", async () => {
    h.user = null;
    expect((await track("TRK-A")).status).toBe(401);
  });

  it("manualProvider throws on a wrong scope argument before any query", async () => {
    const spy = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        seenSql.push(strings.join("?"));
        return db(strings, ...values);
      },
      { unsafe: (text: string) => db.unsafe(text), transaction: (queries: never) => db.transaction(queries) },
    );
    h.target = spy as unknown as Impl;
    for (const bad of [undefined, {}, { username: "admin1" }, { mode: "one" }, { mode: "one", departmentId: "1" }]) {
      await expect(manualProvider.track("TRK-A", bad as never)).rejects.toThrow("requires a DepartmentScope");
    }
    expect(seenSql).toEqual([]);
  });
});

describe("flag OFF (legacy): unchanged and never mentions department_id", () => {
  it("emits no department_id and finds both departments' numbers", async () => {
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

    expect(await (await track("TRK-A")).json()).toMatchObject({ status: "In Transit" });
    expect(await (await track("TRK-B")).json()).toMatchObject({ status: "In Transit" });
    expect(seenSql.length).toBeGreaterThanOrEqual(2);
    expect(seenSql.filter((text) => /department_id/i.test(text))).toEqual([]);
  });
});
