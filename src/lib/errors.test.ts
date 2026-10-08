import { describe, expect, it } from "vitest";
import { AppError, ERROR_CATALOGUE, getErrorDef, type ErrorCode } from "./errors";

const THAI = /[\u0E00-\u0E7F]/;

describe("ERROR_CATALOGUE", () => {
  it("gives every code a non-empty Thai message and hint", () => {
    for (const [code, def] of Object.entries(ERROR_CATALOGUE)) {
      expect(def.message.trim(), code).not.toBe("");
      expect(def.hint.trim(), code).not.toBe("");
      expect(def.message, code).toMatch(THAI);
      expect(def.hint, code).toMatch(THAI);
    }
  });

  it("keeps the statuses existing clients rely on", () => {
    expect(ERROR_CATALOGUE.REAGENT_INACTIVE.status).toBe(409);
    expect(ERROR_CATALOGUE.SHELF_LIFE_BELOW_MINIMUM.status).toBe(409);
    expect(ERROR_CATALOGUE.NETWORK_OFFLINE.status).toBe(0);
    expect(ERROR_CATALOGUE.TIMEOUT.status).toBe(0);
    expect(ERROR_CATALOGUE.INTERNAL_ERROR.status).toBe(500);
  });
});

describe("getErrorDef", () => {
  it("falls back to INTERNAL_ERROR for unknown codes", () => {
    expect(getErrorDef("NOPE")).toBe(ERROR_CATALOGUE.INTERNAL_ERROR);
    expect(getErrorDef("toString")).toBe(ERROR_CATALOGUE.INTERNAL_ERROR);
  });
  it("returns the definition for known codes", () => {
    expect(getErrorDef("FORBIDDEN").status).toBe(403);
  });
});

describe("AppError", () => {
  it("uses catalogue text by default and the code as Error.message", () => {
    const err = new AppError("ITEM_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "ITEM_NOT_FOUND", status: 404, message: "ITEM_NOT_FOUND", extra: {} });
    expect(err.userMessage).toBe(ERROR_CATALOGUE.ITEM_NOT_FOUND.message);
    expect(err.hint).toBe(ERROR_CATALOGUE.ITEM_NOT_FOUND.hint);
  });

  it("accepts overrides, detail, cause and extra", () => {
    const cause = new Error("root");
    const err = new AppError("VALIDATION_FAILED" as ErrorCode, { message: "m", hint: "h", detail: "internal", cause, extra: { field: "qty" } });
    expect(err).toMatchObject({ userMessage: "m", hint: "h", message: "internal", extra: { field: "qty" } });
    expect(err.cause).toBe(cause);
  });
});
