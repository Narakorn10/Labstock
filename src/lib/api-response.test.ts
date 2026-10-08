import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ default: Object.assign(() => Promise.resolve([]), { transaction: () => Promise.resolve([]) }) }));

import { apiError, toApiError } from "./api-response";
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
