import { describe, expect, it, vi } from "vitest";
import { fetchDepartmentContext, postDepartmentSwitch, switchDepartment } from "@/lib/department-session-client";

// Gap-filling tests (step 6, step 4). Not repeating department-session-client.test.ts.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("postDepartmentSwitch / switchDepartment extra", () => {
  it("the request has exactly the keys method, credentials, headers, body (no signal / mode / extra auth)", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    await postDepartmentSwitch(2, fetchImpl);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.keys(init).sort()).toEqual(["body", "credentials", "headers", "method"]);
    expect(Object.keys(init.headers as object)).toEqual(["Content-Type"]);
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["departmentId"]);
  });

  it("every status 100-599: never throws; only 2xx -> reload; only 409 DEPARTMENTS_DISABLED -> hide; everything else { error }", async () => {
    for (const status of [200, 201, 204, 301, 400, 401, 402, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 504]) {
      // 204 / 3xx cannot carry a body in the Response constructor in every case, so build them without one.
      const make = () => (status === 204 ? new Response(null, { status }) : status >= 300 && status < 400 ? new Response(null, { status }) : json(status, { error: "x", code: "SOME" }));
      const out = await switchDepartment(2, async () => make());
      if (status >= 200 && status < 300) expect(out, String(status)).toBe("reload");
      else expect(typeof out === "object" && "error" in out, String(status)).toBe(true);
    }
  });

  it("409 with another code (DEPARTMENT_READ_ONLY) is an error, not hide", async () => {
    const out = await switchDepartment("ALL", async () => json(409, { error: "อ่านอย่างเดียว", code: "DEPARTMENT_READ_ONLY" }));
    expect(out).toMatchObject({ error: { code: "DEPARTMENT_READ_ONLY" } });
  });

  it("a 2xx whose body is not JSON (or whose json() rejects) is still 'reload'", async () => {
    expect(await switchDepartment(2, async () => new Response("OK", { status: 200 }))).toBe("reload");
    const rejecting = { ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad")) } as unknown as Response;
    expect(await switchDepartment(2, async () => rejecting)).toBe("reload");
  });

  it("an error response whose json() rejects still gives { error } with the Thai fallback", async () => {
    const rejecting = { ok: false, status: 500, json: () => Promise.reject(new SyntaxError("bad")) } as unknown as Response;
    const out = await switchDepartment(2, async () => rejecting);
    expect(out).toMatchObject({ error: { message: "สลับงานไม่สำเร็จ" } });
  });

  it("an AbortError / TypeError / non-Error throw all end as { error } (no throw escapes)", async () => {
    for (const thrown of [new DOMException("aborted", "AbortError"), new TypeError("x"), "string", undefined, null]) {
      const out = await switchDepartment(2, async () => {
        throw thrown;
      });
      expect(typeof out === "object" && "error" in out, String(thrown)).toBe(true);
    }
  });

  it("an invalid target never reaches the network and resolves to { error }", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const out = await switchDepartment(Number.NaN, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(typeof out === "object" && "error" in out).toBe(true);
  });
});

describe("fetchDepartmentContext extra", () => {
  it("every non-ok status -> undefined, and it never calls anything other than GET /api/auth/me", async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
      const fetchImpl = vi.fn(async () => json(status, { error: "x" }));
      expect(await fetchDepartmentContext(fetchImpl), String(status)).toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/auth/me");
    }
  });

  it("200 with a JSON body that is not an object (null / array-less string) -> undefined, not a throw", async () => {
    expect(await fetchDepartmentContext(async () => json(200, null))).toBeUndefined();
    expect(await fetchDepartmentContext(async () => json(200, "text"))).toBeUndefined();
  });

  it("200 whose departmentContext has options of the wrong shape -> ctx with options null (kept, not dropped)", async () => {
    const body = { departmentContext: { scope: 1, active: null, options: "x", canViewAll: true, readOnly: false } };
    expect(await fetchDepartmentContext(async () => json(200, body))).toMatchObject({ options: null, canViewAll: true });
  });

  it("a synchronous throw from fetch -> undefined", async () => {
    expect(
      await fetchDepartmentContext((() => {
        throw new Error("sync");
      }) as never),
    ).toBeUndefined();
  });
});
