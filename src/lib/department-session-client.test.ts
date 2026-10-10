import { describe, expect, it, vi } from "vitest";
import { fetchDepartmentContext, postDepartmentSwitch, switchDepartment } from "@/lib/department-session-client";
import type { DepartmentContext } from "@/lib/department-switcher-state";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ctx: DepartmentContext = {
  scope: 1,
  active: { id: 1, name: "เคมีคลินิก", code: "CC" },
  options: [
    { id: 1, name: "เคมีคลินิก", code: "CC" },
    { id: 2, name: "จุลชีววิทยา", code: "MB" },
  ],
  canViewAll: false,
  readOnly: false,
};

describe("postDepartmentSwitch request", () => {
  it("sends POST, same-origin, Content-Type only, body {departmentId} only, no Authorization", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true }));
    await postDepartmentSwitch(2, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/session/department");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain("authorization");
    expect(JSON.parse(init.body as string)).toEqual({ departmentId: 2 });
  });

  it("sends 'ALL' as departmentId", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    await postDepartmentSwitch("ALL", fetchImpl);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ departmentId: "ALL" });
  });

  it("does not call fetch for a broken target", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    for (const bad of [NaN, 1.5, "x", null, undefined] as unknown[]) {
      const r = await postDepartmentSwitch(bad as number, fetchImpl);
      expect(r.status).toBe(0);
      expect(r.code).toBe("INVALID_TARGET");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("postDepartmentSwitch result (never throws)", () => {
  it("200 -> status 200, no error", async () => {
    const r = await postDepartmentSwitch(2, async () => json(200, { success: true }));
    expect(r).toEqual({ status: 200, code: "" });
  });

  it.each([400, 401, 403, 404, 500])("%i -> error info, no throw", async (status) => {
    const r = await postDepartmentSwitch(2, async () => json(status, { error: "ผิดพลาด", code: "SOME_CODE" }));
    expect(r.status).toBe(status);
    expect(r.code).toBe("SOME_CODE");
    expect(r.error).toMatchObject({ message: "ผิดพลาด", status });
  });

  it("409 DEPARTMENTS_DISABLED keeps its code", async () => {
    const r = await postDepartmentSwitch(2, async () => json(409, { error: "x", code: "DEPARTMENTS_DISABLED" }));
    expect(r).toMatchObject({ status: 409, code: "DEPARTMENTS_DISABLED" });
  });

  it("non-JSON error body falls back to the Thai message", async () => {
    const r = await postDepartmentSwitch(2, async () => new Response("<html>", { status: 502 }));
    expect(r.status).toBe(502);
    expect(r.error?.message).toBe("สลับงานไม่สำเร็จ");
  });

  it("fetch rejects -> status 0 NETWORK_OFFLINE", async () => {
    const r = await postDepartmentSwitch(2, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r.status).toBe(0);
    expect(r.code).toBe("NETWORK_OFFLINE");
    expect(r.error?.code).toBe("NETWORK_OFFLINE");
  });

  it("fetch throws synchronously -> still no throw", async () => {
    const r = await postDepartmentSwitch(2, (() => {
      throw new Error("boom");
    }) as never);
    expect(r.status).toBe(0);
  });
});

describe("switchDepartment outcome", () => {
  it("200 -> 'reload'", async () => {
    expect(await switchDepartment(2, async () => json(200, {}))).toBe("reload");
  });
  it("409 DEPARTMENTS_DISABLED -> 'hide'", async () => {
    expect(await switchDepartment(2, async () => json(409, { code: "DEPARTMENTS_DISABLED" }))).toBe("hide");
  });
  it.each([400, 401, 403, 404, 500])("%i -> { error } (no signOut/redirect: just a value)", async (status) => {
    const out = await switchDepartment(2, async () => json(status, { error: "ผิดพลาด" }));
    expect(out).toMatchObject({ error: { message: "ผิดพลาด", status } });
  });
  it("network failure -> { error } with NETWORK_OFFLINE", async () => {
    const out = await switchDepartment(2, async () => {
      throw new TypeError("offline");
    });
    expect(out).toMatchObject({ error: { code: "NETWORK_OFFLINE" } });
  });
});

describe("fetchDepartmentContext", () => {
  it("GET /api/auth/me, same-origin, no Authorization; 200 -> parsed ctx", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true, user: {}, departmentContext: ctx }));
    expect(await fetchDepartmentContext(fetchImpl)).toEqual(ctx);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/me");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toBeUndefined();
  });

  it("200 without departmentContext (flag off) -> null", async () => {
    expect(await fetchDepartmentContext(async () => json(200, { success: true, user: {} }))).toBeNull();
  });

  it("200 with broken ctx -> null (not a throw)", async () => {
    expect(await fetchDepartmentContext(async () => json(200, { departmentContext: { scope: "x" } }))).toBeNull();
  });

  it("401 / 500 -> undefined (caller keeps current state; no signOut path)", async () => {
    expect(await fetchDepartmentContext(async () => json(401, { error: "Unauthorized" }))).toBeUndefined();
    expect(await fetchDepartmentContext(async () => json(500, { error: "x" }))).toBeUndefined();
  });

  it("throw / bad JSON -> undefined", async () => {
    expect(
      await fetchDepartmentContext(async () => {
        throw new TypeError("offline");
      }),
    ).toBeUndefined();
    expect(await fetchDepartmentContext(async () => new Response("not json", { status: 200 }))).toBeUndefined();
  });
});
