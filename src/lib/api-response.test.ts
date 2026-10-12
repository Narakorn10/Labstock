import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ default: Object.assign(() => Promise.resolve([]), { transaction: () => Promise.resolve([]) }) }));

import { apiError, departmentScopeErrorResponse, isDepartmentScopeFailure, toApiError } from "./api-response";
import { DepartmentScopeError, departmentErrorResponse } from "./scoped-db";
import { AppError, ERROR_CATALOGUE } from "./errors";
import { CountConfirmError } from "./count-work-orders";
import { PurchaseOrderCreationError } from "./purchase-order-creation";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

const map = async (err: unknown) => {
  const { response, internalMessage } = toApiError(err, "req-1");
  return { status: response.status, body: await response.json(), internalMessage, response };
};

describe("apiError", () => {
  it("returns Thai error, code, hint, requestId and the x-request-id header", async () => {
    const response = apiError("FORBIDDEN", { requestId: "abc" });
    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(await response.json()).toEqual({
      error: ERROR_CATALOGUE.FORBIDDEN.message, code: "FORBIDDEN", hint: ERROR_CATALOGUE.FORBIDDEN.hint, requestId: "abc",
    });
  });

  it("spreads extra at top level and honours overrides", async () => {
    const response = apiError("PO_STATE_CONFLICT", { requestId: "r", message: "m", hint: "h", status: 418, extra: { poId: 5, error: "ignored" } });
    expect(response.status).toBe(418);
    expect(await response.json()).toMatchObject({ poId: 5, error: "m", hint: "h", code: "PO_STATE_CONFLICT" });
  });
});

describe("toApiError", () => {
  it("maps AppError", async () => {
    const r = await map(new AppError("LOT_NOT_AVAILABLE", { detail: "lot 7 empty", extra: { lotNo: "7" } }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "LOT_NOT_AVAILABLE", lotNo: "7", requestId: "req-1" });
    expect(r.internalMessage).toBe("lot 7 empty");
    expect(r.response.headers.get("x-request-id")).toBe("req-1");
  });

  it("maps CountConfirmError keeping failed/remaining at top level", async () => {
    const failed = [{ itemId: "R1" }] as never;
    const r = await map(new CountConfirmError("raw thai text", failed, []));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "COUNT_NOTHING_TO_DISPENSE", failed: [{ itemId: "R1" }], remaining: [] });
  });

  it("maps PurchaseOrderCreationError by status", async () => {
    expect((await map(new PurchaseOrderCreationError("x", 404))).body.code).toBe("PO_NOT_FOUND");
    expect((await map(new PurchaseOrderCreationError("x", 409))).body.code).toBe("PO_STATE_CONFLICT");
    const r = await map(new PurchaseOrderCreationError("bad qty"));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_FAILED");
  });

  it("maps legacy message prefixes", async () => {
    const inactive = await map(new Error("REAGENT_INACTIVE: R1"));
    expect(inactive.status).toBe(409);
    expect(inactive.body.code).toBe("REAGENT_INACTIVE");
    const stock = await map(new Error("REAGENT_STOCK_INSUFFICIENT: R1"));
    expect(stock.status).toBe(409);
    expect(stock.body.code).toBe("REAGENT_STOCK_INSUFFICIENT");
  });

  it("puts only the item id from a legacy reagent message into the Thai text", async () => {
    const inactive = await map(new Error("REAGENT_INACTIVE: R1"));
    expect(inactive.body.error).toBe("สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (R1)");
    const trigger = await map(new Error("REAGENT_INACTIVE:CHEM-R-001"));
    expect(trigger.body.error).toBe("สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (CHEM-R-001)");
    const stock = await map(new Error("REAGENT_STOCK_INSUFFICIENT: R1"));
    expect(stock.body.error).toBe("จำนวนคงเหลือไม่พอสำหรับรายการที่เบิก (R1)");
    const messy = await map(new Error("REAGENT_INACTIVE: R1 password=secret at db.internal"));
    expect(messy.body.error).toBe("สารเคมีรายการนี้ถูกปิดใช้งานแล้ว");
    expect(JSON.stringify(messy.body)).not.toContain("secret");
  });

  it("maps SyntaxError to INVALID_JSON", async () => {
    const r = await map(new SyntaxError("Unexpected end of JSON input"));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_JSON");
  });

  it("maps SQLSTATE codes", async () => {
    const pg = (code: string) => Object.assign(new Error("db said no"), { code });
    expect((await map(pg("23505"))).body.code).toBe("DUPLICATE_ENTRY");
    expect((await map(pg("08006"))).body.code).toBe("DB_UNAVAILABLE");
    expect((await map(pg("57P01"))).body.code).toBe("DB_UNAVAILABLE");
    expect((await map(new TypeError("fetch failed"))).body.code).toBe("DB_UNAVAILABLE");
    expect((await map(pg("42P01"))).body.code).toBe("INTERNAL_ERROR");
  });

  it("falls back to INTERNAL_ERROR 500", async () => {
    const r = await map(new Error("something odd"));
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL_ERROR");
  });

  it("never leaks the raw message into the body but returns it as internalMessage", async () => {
    const secret = "relation \"users\" password=hunter2 does not exist";
    for (const err of [new Error(secret), Object.assign(new Error(secret), { code: "23505" }), Object.assign(new Error(secret), { code: "08006" }), new SyntaxError(secret), secret]) {
      const r = await map(err);
      expect(JSON.stringify(r.body)).not.toContain("hunter2");
      expect(r.internalMessage).toContain("hunter2");
    }
  });

  it("never throws on hostile input", async () => {
    const hostile = { get message(): string { throw new Error("getter"); }, get code(): string { throw new Error("getter"); } };
    for (const err of [null, undefined, 42, hostile, Object.create(null)]) {
      expect(() => toApiError(err, "req-1")).not.toThrow();
      const { response } = toApiError(err, "req-1");
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("department scope errors", () => {
  const codes = [
    ["DEPARTMENT_NOT_FOUND", 404],
    ["DEPARTMENT_READ_ONLY", 409],
    ["DEPARTMENT_SCOPE_MISSING", 500],
  ] as const;

  it.each(codes)("maps DepartmentScopeError %s to the catalogue status", async (code, status) => {
    const r = await map(new DepartmentScopeError(code));
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code === "DEPARTMENT_SCOPE_MISSING" ? "INTERNAL_ERROR" : code);
  });

  it("does not leak the username from a DEPARTMENT_SCOPE_MISSING message", async () => {
    const err = new DepartmentScopeError("DEPARTMENT_SCOPE_MISSING", 'departments are ready but user "somchai" has no department scope');
    const direct = departmentScopeErrorResponse(err, "req-1");
    expect(direct?.status).toBe(500);
    expect(JSON.stringify(await direct?.json())).not.toContain("somchai");
    expect(JSON.stringify((await map(err)).body)).not.toContain("somchai");
  });

  it("departmentScopeErrorResponse returns null for other errors", () => {
    expect(departmentScopeErrorResponse(new Error("boom"), "req-1")).toBeNull();
    expect(departmentScopeErrorResponse("DepartmentScopeError", "req-1")).toBeNull();
    expect(departmentScopeErrorResponse(null, "req-1")).toBeNull();
  });

  it.each(codes)("departmentErrorResponse and toApiError agree on %s", async (code) => {
    const err = new DepartmentScopeError(code);
    const a = departmentErrorResponse(err, "req-1")!;
    const b = toApiError(err, "req-1").response;
    expect(a.status).toBe(b.status);
    expect((await a.json()).code).toBe((await b.json()).code);
  });

  it("isDepartmentScopeFailure recognises the 3 forms and rejects others", () => {
    expect(isDepartmentScopeFailure(new DepartmentScopeError("DEPARTMENT_READ_ONLY"))).toBe(true);
    expect(isDepartmentScopeFailure(new AppError("ITEM_NOT_IN_DEPARTMENT"))).toBe(true);
    expect(isDepartmentScopeFailure(new Error("ITEM_NOT_IN_DEPARTMENT: X"))).toBe(true);
    expect(isDepartmentScopeFailure(new AppError("REAGENT_INACTIVE"))).toBe(false);
    expect(isDepartmentScopeFailure(new Error("boom"))).toBe(false);
    expect(isDepartmentScopeFailure("boom")).toBe(false);
  });

  it("maps AppError ITEM_NOT_IN_DEPARTMENT to 409 Thai", async () => {
    const r = await map(new AppError("ITEM_NOT_IN_DEPARTMENT", { message: "รายการนี้ไม่อยู่ในงานของคุณ (X)", detail: "ITEM_NOT_IN_DEPARTMENT: X" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(r.body.error).toBe("รายการนี้ไม่อยู่ในงานของคุณ (X)");
    expect((await map(new AppError("ITEM_NOT_IN_DEPARTMENT"))).body.error).toBe("รายการนี้ไม่อยู่ในงานของคุณ");
  });

  it("maps a legacy ITEM_NOT_IN_DEPARTMENT message to 409 with the item id", async () => {
    const r = await map(new Error("ITEM_NOT_IN_DEPARTMENT: X"));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ITEM_NOT_IN_DEPARTMENT");
    expect(r.body.error).toBe("รายการนี้ไม่อยู่ในงานของคุณ (X)");
    const odd = await map(new Error("ITEM_NOT_IN_DEPARTMENT: some free text here"));
    expect(odd.body.error).toBe("รายการนี้ไม่อยู่ในงานของคุณ");
  });

  it("keeps existing mappings unchanged", async () => {
    expect((await map(new Error("REAGENT_INACTIVE: R1"))).body.error).toBe("สารเคมีรายการนี้ถูกปิดใช้งานแล้ว (R1)");
    expect((await map(new Error("something odd"))).status).toBe(500);
  });
});
