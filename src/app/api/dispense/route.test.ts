import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn().mockResolvedValue([]),
  hasMenuPermission: vi.fn(),
  runDispenseBatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ hasMenuPermission: mocks.hasMenuPermission }));
vi.mock("@/lib/stock-transactions", () => ({ runDispenseBatch: mocks.runDispenseBatch }));

import { AppError } from "@/lib/errors";
import { DepartmentScopeError } from "@/lib/scoped-db";
import { POST } from "./route";

function dispenseRequest(init: { headers?: Record<string, string>; body?: string } = {}) {
  return new Request("http://localhost/api/dispense", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.body ?? JSON.stringify({ batchItems: [{ itemId: "CHEM-R-001", lotNo: "L1", qty: 1, inventoryId: 1 }] }),
  });
}

describe("Dispense API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no authenticated user exists", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    expect((await POST(dispenseRequest())).status).toBe(401);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("returns 403 for a role without the dispense menu", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "vendor", role: "Vendor" }, allowed: false });
    expect((await POST(dispenseRequest())).status).toBe(403);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("dispenses stock for a role with the dispense menu", async () => {
    const user = { username: "staff", name: "Staff", role: "Operator" };
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });
    mocks.runDispenseBatch.mockResolvedValue({ success: true });

    const response = await POST(dispenseRequest());

    expect(response.status).toBe(200);
    expect(mocks.hasMenuPermission).toHaveBeenCalledWith(expect.any(Request), "dispense");
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(expect.any(Array), user, expect.any(Object), { mode: "legacy" });
  });

  it("records who tried to dispense and why it was refused", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { username: "6928", role: "Vendor" }, allowed: false });

    await POST(dispenseRequest());

    const values = mocks.sql.mock.calls[0].slice(1);
    expect(values).toEqual(expect.arrayContaining(["6928", "Vendor", "dispense", "/api/dispense", "rejected", 403, "FORBIDDEN: คุณไม่มีสิทธิ์ทำรายการนี้"]));
  });
});

describe("dispense API department scope", () => {
  const baseUser = { username: "staff", name: "Staff", role: "Operator" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runDispenseBatch.mockResolvedValue({ success: true });
  });

  it("passes { mode: \"one\", departmentId } when the user has a department scope", async () => {
    const user = { ...baseUser, scope: 2 };
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });

    const response = await POST(dispenseRequest());

    expect(response.status).toBe(200);
    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(expect.any(Array), user, expect.any(Object), { mode: "one", departmentId: 2 });
  });

  it("answers 404 and never dispenses when the user asked for a department they are not in", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { ...baseUser, scope: 2, departmentDenied: true }, allowed: true });

    const response = await POST(dispenseRequest());

    expect(response.status).toBe(404);
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("maps DEPARTMENT_READ_ONLY to 409", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { ...baseUser, scope: "ALL" }, allowed: true });
    mocks.runDispenseBatch.mockRejectedValue(new DepartmentScopeError("DEPARTMENT_READ_ONLY"));

    const response = await POST(dispenseRequest());

    expect(mocks.runDispenseBatch).toHaveBeenCalledWith(expect.any(Array), expect.anything(), expect.any(Object), { mode: "all" });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEPARTMENT_READ_ONLY");
  });

  it("maps ITEM_NOT_IN_DEPARTMENT to 409 with the Thai message", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: { ...baseUser, scope: 2 }, allowed: true });
    mocks.runDispenseBatch.mockRejectedValue(new AppError("ITEM_NOT_IN_DEPARTMENT", {
      message: "รายการนี้ไม่อยู่ในงานของคุณ (LAB-000001)",
      detail: "ITEM_NOT_IN_DEPARTMENT: LAB-000001",
    }));

    const response = await POST(dispenseRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(body.error).toContain("รายการนี้ไม่อยู่ในงานของคุณ");
  });
});

describe("dispense API error responses", () => {
  const user = { username: "staff", name: "Staff", role: "Operator" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasMenuPermission.mockResolvedValue({ user, allowed: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("401 uses the catalogue body", async () => {
    mocks.hasMenuPermission.mockResolvedValue({ user: null, allowed: false });
    const response = await POST(dispenseRequest());
    const body = await response.json();
    expect(body).toMatchObject({ code: "AUTH_REQUIRED", error: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
    expect(body.hint).toEqual(expect.any(String));
  });

  it("maps REAGENT_INACTIVE to 409", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new AppError("REAGENT_INACTIVE", { detail: "REAGENT_INACTIVE: R1" }));
    const response = await POST(dispenseRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("REAGENT_INACTIVE");
  });

  it("returns 400 VALIDATION_FAILED when batchItems is missing or empty", async () => {
    for (const body of [{}, { batchItems: [] }, { batchItems: "x" }]) {
      const response = await POST(dispenseRequest({ body: JSON.stringify(body) }));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILED");
    }
    expect(mocks.runDispenseBatch).not.toHaveBeenCalled();
  });

  it("hides raw database errors behind a 500 INTERNAL_ERROR", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new Error("relation x does not exist"));
    const response = await POST(dispenseRequest());
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("relation");
  });

  it("returns 400 INVALID_JSON for an unreadable body", async () => {
    const response = await POST(dispenseRequest({ body: "{not json" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_JSON");
  });

  it("puts the same requestId in the body and the x-request-id header", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new Error("boom"));
    const response = await POST(dispenseRequest());
    const body = await response.json();
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("echoes an incoming x-request-id", async () => {
    mocks.runDispenseBatch.mockRejectedValue(new Error("boom"));
    const response = await POST(dispenseRequest({ headers: { "x-request-id": "req-abc-123" } }));
    expect(response.headers.get("x-request-id")).toBe("req-abc-123");
    expect((await response.json()).requestId).toBe("req-abc-123");
  });
});
