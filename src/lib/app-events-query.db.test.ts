import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { getRepeatedFailures, listAppEvents, purgeOldAppEvents } from "./app-events-query";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_events (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), request_id TEXT, username TEXT, role TEXT,
    action TEXT NOT NULL, route TEXT NOT NULL, method TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
    status INTEGER, message TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, duration_ms INTEGER);
`;

const MSG = "ยอดจัดสรร Lot ต้องครบ";

beforeEach(async () => {
  if (!schemaReady) {
    await sql.db.exec(SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec(`
    TRUNCATE app_events RESTART IDENTITY;
    INSERT INTO app_events (created_at, username, role, action, route, outcome, status, message, details) VALUES
      (NOW() - INTERVAL '100 days','0001', 'User',    'dispense',      '/api/dispense',                     'success',  200, NULL,     '{}'),
      (NOW() - INTERVAL '10 days', '6928', 'User',    'count.confirm', '/api/count-work-orders/31/confirm', 'rejected', 400, '${MSG}', '{"workOrderId":31}'),
      (NOW() - INTERVAL '2 days',  '6928', 'User',    'count.confirm', '/api/count-work-orders/31/confirm', 'rejected', 400, '${MSG}', '{"workOrderId":31}'),
      (NOW() - INTERVAL '2 days',  '5783', 'Manager', 'count.confirm', '/api/count-work-orders/1/confirm',  'rejected', 400, '${MSG}', '{"workOrderId":1}'),
      (NOW() - INTERVAL '1 day',   '5783', 'Manager', 'dispense',      '/api/dispense',                     'success',  200, NULL,     '{}'),
      (NOW() - INTERVAL '1 hour',  '7268', 'Manager', 'receive',       '/api/receive',                      'error',    500, 'boom',   '{}');
  `);
});

describe("listAppEvents", () => {
  it("returns newest first with camelCase fields", async () => {
    const { items } = await listAppEvents({});
    expect(items.map((row) => row.action)).toEqual(["receive", "dispense", "count.confirm", "count.confirm", "count.confirm", "dispense"]);
    expect(items[2]).toMatchObject({ username: "5783", outcome: "rejected", status: 400, message: MSG, details: { workOrderId: 1 } });
    expect(typeof items[0].id).toBe("number");
  });

  it("filters by user (case-insensitive), action and outcome", async () => {
    expect((await listAppEvents({ username: "6928" })).items).toHaveLength(2);
    expect((await listAppEvents({ action: "dispense" })).items).toHaveLength(2);
    expect((await listAppEvents({ outcome: "error" })).items.map((row) => row.action)).toEqual(["receive"]);
  });

  it("'failed' means every non-success outcome", async () => {
    const { items } = await listAppEvents({ outcome: "failed" });
    expect(items).toHaveLength(4);
    expect(items.every((row) => row.outcome !== "success")).toBe(true);
  });

  it("ignores unknown outcomes and malformed dates instead of failing", async () => {
    expect((await listAppEvents({ outcome: "nonsense", startDate: "not-a-date", endDate: "2026-99" })).items).toHaveLength(6);
  });

  it("paginates with a cursor and never repeats a row", async () => {
    const first = await listAppEvents({ limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).toBe(first.items[3].id);

    const second = await listAppEvents({ limit: 4, before: first.nextCursor as number });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("caps the page size", async () => {
    await sql.db.exec("INSERT INTO app_events (action, route, outcome) SELECT 'x', '/r', 'success' FROM generate_series(1, 250)");
    const { items, nextCursor } = await listAppEvents({ limit: 100000 });
    expect(items).toHaveLength(200);
    expect(nextCursor).not.toBeNull();
  });

  it("filters by Thai calendar day", async () => {
    // 20:00 UTC on 2026-09-20 is 03:00 on 09-21 in Bangkok, so it belongs to 09-21.
    await sql.db.exec(`
      TRUNCATE app_events RESTART IDENTITY;
      INSERT INTO app_events (created_at, action, route, outcome) VALUES
        ('2026-09-20T20:00:00Z', 'edge-bkk-21', '/r', 'success'),
        ('2026-09-20T16:59:00Z', 'edge-bkk-20', '/r', 'success');
    `);
    expect((await listAppEvents({ startDate: "2026-09-21", endDate: "2026-09-21" })).items.map((row) => row.action)).toEqual(["edge-bkk-21"]);
    expect((await listAppEvents({ startDate: "2026-09-20", endDate: "2026-09-20" })).items.map((row) => row.action)).toEqual(["edge-bkk-20"]);
  });
});

describe("getRepeatedFailures", () => {
  it("groups repeated failures from the last 7 days and ranks by distinct users", async () => {
    const repeated = await getRepeatedFailures();
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({ action: "count.confirm", message: MSG, occurrences: 2, users: 2 });
  });

  it("ignores single failures and successes", async () => {
    await sql.db.exec("TRUNCATE app_events");
    await sql.db.exec("INSERT INTO app_events (action, route, outcome, message) VALUES ('receive','/r','error','boom'), ('dispense','/r','success',NULL), ('dispense','/r','success',NULL)");
    expect(await getRepeatedFailures()).toEqual([]);
  });
});

describe("purgeOldAppEvents", () => {
  it("removes only events older than 90 days", async () => {
    expect(await purgeOldAppEvents()).toBe(1);
    const remaining = (await listAppEvents({})).items;
    expect(remaining).toHaveLength(5);
    expect(remaining.some((row) => row.username === "0001")).toBe(false);
  });
});
