import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteSql } from "@/test/pglite-sql";

vi.mock("./db", async () => {
  const { createPgliteSql } = await import("@/test/pglite-sql");
  return { default: createPgliteSql() };
});

import dbSql from "./db";
import { PIN_ATTEMPT_LIMIT, countRecentPinAttempts, markPinAttemptSuccess, recordPinAttempt } from "./pin-attempts";

const sql = dbSql as unknown as PgliteSql;
let schemaReady = false;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_events (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), request_id TEXT, username TEXT, role TEXT,
    action TEXT NOT NULL, route TEXT NOT NULL, method TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
    status INTEGER, message TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, duration_ms INTEGER);
`;

// Mirrors the route: record first, then count, blocked when the count (own row included) exceeds the limit.
const attempt = async (username: string) => {
  const id = await recordPinAttempt(username);
  const n = await countRecentPinAttempts(username);
  return { id, blocked: n !== null && n > PIN_ATTEMPT_LIMIT };
};

beforeEach(async () => {
  if (!schemaReady) {
    await sql.db.exec(SCHEMA);
    schemaReady = true;
  }
  await sql.db.exec("TRUNCATE app_events RESTART IDENTITY");
});

describe("PIN attempt limiter (real SQL)", () => {
  it("stores a rejected 401 pin_attempt row and returns its id", async () => {
    const id = await recordPinAttempt("Tech1");
    expect(typeof id).toBe("number");
    const { rows } = await sql.db.query<{ action: string; outcome: string; status: number; details: Record<string, unknown> }>("SELECT * FROM app_events");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "mobile.pin_attempt", outcome: "rejected", status: 401, details: { attemptedUser: "Tech1" } });
  });

  it("allows 5 attempts and blocks the 6th", async () => {
    for (let i = 1; i <= 5; i++) expect((await attempt("tech1")).blocked).toBe(false);
    expect((await attempt("tech1")).blocked).toBe(true);
  });

  it("treats usernames case-insensitively", async () => {
    for (const name of ["Tech1", "TECH1", "tech1", "tEch1", "teCH1"]) await attempt(name);
    expect(await countRecentPinAttempts("tech1")).toBe(5);
    expect((await attempt("TeCh1")).blocked).toBe(true);
  });

  it("keeps users independent", async () => {
    for (let i = 0; i < 6; i++) await attempt("alice");
    expect((await attempt("alice")).blocked).toBe(true);
    expect((await attempt("bob")).blocked).toBe(false);
    expect(await countRecentPinAttempts("bob")).toBe(1);
  });

  it("does not count attempts older than 15 minutes", async () => {
    for (let i = 0; i < 5; i++) await recordPinAttempt("tech1");
    await sql.db.exec("UPDATE app_events SET created_at = NOW() - INTERVAL '16 minutes'");
    expect(await countRecentPinAttempts("tech1")).toBe(0);
    expect((await attempt("tech1")).blocked).toBe(false);
  });

  it("does not count attempts marked as success", async () => {
    const ids: Array<number | null> = [];
    for (let i = 0; i < 5; i++) ids.push(await recordPinAttempt("tech1"));
    for (const id of ids) await markPinAttemptSuccess(id);
    expect(await countRecentPinAttempts("tech1")).toBe(0);
  });

  it("ignores other actions with the same attemptedUser (e.g. mobile.confirm rows)", async () => {
    await sql.db.exec(`INSERT INTO app_events (action, route, outcome, status, details) VALUES ('mobile.confirm', '/api/mobile/confirm', 'rejected', 401, '{"attemptedUser":"tech1"}')`);
    expect(await countRecentPinAttempts("tech1")).toBe(0);
  });

  it("counts every parallel recordPinAttempt, so concurrency cannot dodge the limit", async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => recordPinAttempt("tech1")));
    expect(ids.every((id) => typeof id === "number")).toBe(true);
    expect(new Set(ids).size).toBe(12);
    expect(await countRecentPinAttempts("tech1")).toBe(12);
  });

  it("counts line-link and confirm attempts together and stores the source", async () => {
    await recordPinAttempt("Tech1", "line-link");
    await recordPinAttempt("TECH1");
    expect(await countRecentPinAttempts("tech1")).toBe(2);
    const { rows } = await sql.db.query<{ source: string }>("SELECT details->>'source' AS source FROM app_events ORDER BY id");
    expect(rows.map((row) => row.source)).toEqual(["line-link", "confirm"]);
  });

  it("never throws and returns null when app_events is missing", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await sql.db.exec("DROP TABLE app_events");
    await expect(recordPinAttempt("tech1")).resolves.toBeNull();
    await expect(countRecentPinAttempts("tech1")).resolves.toBeNull();
    await expect(markPinAttemptSuccess(5)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    await sql.db.exec(SCHEMA);
    spy.mockRestore();
  });
});
