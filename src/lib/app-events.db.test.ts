import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { classifyOutcome, recordAppEvent, summarizeDetails, trackRoute } from "./app-events";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_events (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), request_id TEXT, username TEXT, role TEXT,
    action TEXT NOT NULL, route TEXT NOT NULL, method TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
    status INTEGER, message TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, duration_ms INTEGER);
`;

type Row = { username: string | null; role: string | null; action: string; route: string; method: string; outcome: string; status: number; message: string | null; details: Record<string, unknown>; request_id: string };
const rows = async () => (await sql.db.query<Row>("SELECT * FROM app_events ORDER BY id")).rows;

const request = (body: unknown = {}) => new Request("https://example.test/api/count-work-orders/31/confirm", {
  method: "POST", headers: { "x-request-id": "req-1" }, body: JSON.stringify(body),
});

beforeEach(async () => {
  if (!schemaReady) {
    await sql.db.exec(SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec("TRUNCATE app_events RESTART IDENTITY");
});

describe("summarizeDetails", () => {
  it("keeps only allowlisted keys and drops secrets", () => {
    expect(summarizeDetails({ workOrderId: 31, jobType: "เคมี", pin: "1234", password: "x", token: "t", authorization: "Bearer x", note: "free text" }))
      .toEqual({ workOrderId: 31, jobType: "เคมี" });
  });

  it("filters list entries with the same allowlist and records the total", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ itemId: `R${i}`, qty: 1, pin: "9999" }));
    const out = summarizeDetails({ items }) as { items: Array<Record<string, unknown>>; itemsTotal: number };
    expect(out.items).toHaveLength(50);
    expect(out.itemsTotal).toBe(60);
    expect(out.items[0]).toEqual({ itemId: "R0", qty: 1 });
  });

  it("survives non-object input and odd values", () => {
    expect(summarizeDetails(null)).toEqual({});
    expect(summarizeDetails("pin=1234")).toEqual({});
    expect(summarizeDetails([1, 2])).toEqual({});
    expect(summarizeDetails({ qty: Number.NaN, itemId: { nested: "x" }, items: "nope" })).toEqual({});
  });

  it("truncates long strings", () => {
    expect((summarizeDetails({ itemId: "a".repeat(500) }).itemId as string).length).toBe(100);
  });
});

describe("classifyOutcome", () => {
  it("maps HTTP status to outcome", () => {
    expect(classifyOutcome(200)).toBe("success");
    expect(classifyOutcome(400)).toBe("rejected");
    expect(classifyOutcome(403)).toBe("rejected");
    expect(classifyOutcome(500)).toBe("error");
  });
});

describe("recordAppEvent", () => {
  it("stores the event with filtered details", async () => {
    await recordAppEvent({ username: "6928", role: "User", action: "dispense", route: "/api/dispense", method: "POST", status: 200, details: { count: 2, pin: "1234" } });
    const [row] = await rows();
    expect(row).toMatchObject({ username: "6928", action: "dispense", outcome: "success", status: 200 });
    expect(row.details).toEqual({ count: 2 });
  });

  it("truncates a very long message", async () => {
    await recordAppEvent({ action: "a", route: "/r", status: 400, message: "x".repeat(2000) });
    expect(((await rows())[0].message ?? "").length).toBe(500);
  });

  it("never throws when the insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sql.db.exec("DROP TABLE app_events");
    await expect(recordAppEvent({ action: "a", route: "/r", status: 200 })).resolves.toBeUndefined();
    await sql.db.exec(SCHEMA);
    spy.mockRestore();
  });
});

describe("trackRoute", () => {
  it("records a rejected request with the user, message and details, and returns the response unchanged", async () => {
    const handler = trackRoute({ action: "count.confirm" }, async (_request, ctx) => {
      ctx.user = { username: "6928", role: "User" };
      ctx.details = { workOrderId: 31, items: [{ itemId: "R1", inventoryId: 3, qty: 6 }], pin: "1234" };
      return Response.json({ error: "ยอดจัดสรร Lot ต้องครบ" }, { status: 400 });
    });
    const response = await handler(request(), undefined);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ยอดจัดสรร Lot ต้องครบ" });

    const [row] = await rows();
    expect(row).toMatchObject({
      username: "6928", role: "User", action: "count.confirm", route: "/api/count-work-orders/31/confirm",
      method: "POST", outcome: "rejected", status: 400, message: "ยอดจัดสรร Lot ต้องครบ", request_id: "req-1",
    });
    expect(row.details).toEqual({ workOrderId: 31, items: [{ itemId: "R1", inventoryId: 3, qty: 6 }], itemsTotal: 1 });
  });

  it("records a success without a message", async () => {
    const handler = trackRoute({ action: "dispense" }, async () => Response.json({ success: true }));
    await handler(request(), undefined);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "success", status: 200, message: null, username: null });
  });

  it("turns a thrown error into a safe response, with the real cause only in the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = trackRoute({ action: "receive" }, async () => { throw new Error("boom password=secret"); });
    const response = await handler(request(), undefined);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    const body = await response.json();
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", requestId: "req-1" });
    expect(JSON.stringify(body)).not.toContain("secret");
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "error", status: 500, message: "INTERNAL_ERROR: boom password=secret", request_id: "req-1" });
    spy.mockRestore();
  });

  it("ctx.fail maps the error, exposes the request id and logs code plus real cause", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = trackRoute({ action: "dispense" }, async (_request, ctx) => {
      expect(ctx.requestId).toBe("req-1");
      return ctx.fail(new Error("REAGENT_INACTIVE: R9"));
    });
    const response = await handler(request(), undefined);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("REAGENT_INACTIVE");
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "rejected", status: 409, message: "REAGENT_INACTIVE: R9", request_id: "req-1" });
    spy.mockRestore();
  });

  it("uses one generated request id for the row, the context and the header", async () => {
    let seen = "";
    const handler = trackRoute({ action: "x" }, async (_request, ctx) => { seen = ctx.requestId; return Response.json({ ok: 1 }); });
    const response = await handler(new Request("https://example.test/api/x", { method: "POST" }), undefined);
    const [row] = await rows();
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).toBe(seen);
    expect(row.request_id).toBe(seen);
  });

  it("prefixes the code when a returned error body carries one", async () => {
    const handler = trackRoute({ action: "x" }, async () => Response.json({ error: "ข้อความ", code: "FORBIDDEN" }, { status: 403 }));
    await handler(request(), undefined);
    expect((await rows())[0].message).toBe("FORBIDDEN: ข้อความ");
  });

  it("still returns the response when recording fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sql.db.exec("DROP TABLE app_events");
    const handler = trackRoute({ action: "dispense" }, async () => Response.json({ ok: 1 }, { status: 201 }));
    const response = await handler(request(), undefined);
    expect(response.status).toBe(201);
    await sql.db.exec(SCHEMA);
    spy.mockRestore();
  });

  it("passes the route context through to the handler", async () => {
    const handler = trackRoute<{ params: Promise<{ id: string }> }>({ action: "x" }, async (_request, _ctx, { params }) => Response.json({ id: (await params).id }));
    const response = await handler(request(), { params: Promise.resolve({ id: "7" }) });
    expect(await response.json()).toEqual({ id: "7" });
  });
});
