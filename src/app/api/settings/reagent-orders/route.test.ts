import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): unknown;
    transaction: ReturnType<typeof vi.fn>;
    mockClear: () => void;
    mock: { results: Array<{ value: { strings: TemplateStringsArray; values: unknown[] } }> };
  };
  sql.transaction = vi.fn();
  return { sql, getAuthenticatedUser: vi.fn() };
});

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { GET, PATCH, POST } from "./route";

const validPayload = {
  item_id: "CHEM-R-001",
  expected_revision: 1,
  tests_per_box: null,
  avg_patient_tests_per_month: 0,
  iqc_tests_per_month: 0,
  documented_actual_withdrawal_boxes: null,
  source_verification_status: "NEEDS_REVIEW",
  approved_monthly_target_boxes: 15,
  approved_order_qty_boxes: 8,
  orders_per_month: 2,
  lead_time_days: 7,
  safety_stock_boxes: 2,
  min_order_qty_boxes: 1,
  order_multiple_boxes: 1,
  review_days: 15,
  enabled: true,
  reason: "manual plan",
  change_reason: "reviewed source document",
};

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/settings/reagent-orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Admin reagent-order policy API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/settings/reagent-orders")))!.status).toBe(401);
  });

  it("returns 403 for an authenticated non-manager", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "staff", role: "User" });
    expect((await PATCH(patchRequest(validPayload)))!.status).toBe(403);
  });

  it("allows a Manager to update a policy", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "manager", role: "Manager" });
    mocks.sql.transaction.mockResolvedValue([[{ item_id: "CHEM-R-001", revision: 2 }]]);
    expect((await PATCH(patchRequest(validPayload)))!.status).toBe(200);
  });

  it("rejects invalid policy values before starting a transaction", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "admin", role: "Admin" });
    const response = await PATCH(patchRequest({ ...validPayload, orders_per_month: 0 }));
    expect(response!.status).toBe(400);
    expect(mocks.sql.transaction).not.toHaveBeenCalled();
  });

  it("rejects a fractional approved cycle quantity that PO creation cannot store", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "admin", role: "Admin" });
    const response = await PATCH(patchRequest({ ...validPayload, approved_order_qty_boxes: 1.5 }));
    expect(response!.status).toBe(400);
    expect(mocks.sql.transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when the optimistic revision no longer matches", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "admin", role: "Admin" });
    mocks.sql.transaction.mockResolvedValue([[]]);
    expect((await PATCH(patchRequest(validPayload)))!.status).toBe(409);
  });

  it("updates policy and writes before/after audit in the same transaction", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "admin", role: "Admin" });
    mocks.sql.transaction.mockResolvedValue([[{ item_id: "CHEM-R-001", revision: 2 }]]);
    const response = await PATCH(patchRequest(validPayload));

    expect(response!.status).toBe(200);
    expect(mocks.sql.transaction).toHaveBeenCalledTimes(1);
    const queries = mocks.sql.transaction.mock.calls[0][0] as Array<{ strings: TemplateStringsArray }>;
    expect(queries).toHaveLength(1);
    const statement = Array.from(queries[0].strings).join(" ");
    expect(statement).toContain("FOR UPDATE");
    expect(statement).toContain("UPDATE reagent_order_policy");
    expect(statement).toContain("INSERT INTO reagent_order_policy_history");
    expect(statement).toContain("to_jsonb(current)");
    expect(statement).toContain("to_jsonb(updated)");
  });

  it("creates an unconfigured policy with revision one and an audit record", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ username: "admin", role: "Admin" });
    mocks.sql.transaction.mockResolvedValue([[{ item_id: "LAB-000001", revision: 1 }]]);
    const response = await POST(patchRequest({ ...validPayload, expected_revision: 0 }));

    expect(response!.status).toBe(201);
    const queries = mocks.sql.transaction.mock.calls[0][0] as Array<{ strings: TemplateStringsArray }>;
    const statement = Array.from(queries[0].strings).join(" ");
    expect(statement).toContain("INSERT INTO reagent_order_policy");
    expect(statement).toContain("ON CONFLICT (item_id) DO NOTHING");
    expect(statement).toContain("INSERT INTO reagent_order_policy_history");
  });
});
