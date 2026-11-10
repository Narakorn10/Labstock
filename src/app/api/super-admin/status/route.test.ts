import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/lib/api-response";

const h = vi.hoisted(() => ({
  guard: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/db", () => ({ default: () => Promise.resolve([]) }));

vi.mock("@/lib/app-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/app-events")>("@/lib/app-events");
  return { ...actual, recordAppEvent: async () => undefined };
});

vi.mock("@/lib/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => (h.guard as () => Promise<unknown>)()),
}));

import { GET } from "./route";

const call = () => GET(new Request("http://localhost/api/super-admin/status"));

beforeEach(() => {
  h.guard = null;
});

describe("GET /api/super-admin/status", () => {
  it("200 {superAdmin:true} for the Super admin", async () => {
    h.guard = async () => ({ username: "sa", name: "Super", role: "Admin" });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ superAdmin: true });
  });

  it("401 when signed out", async () => {
    h.guard = async () => apiError("AUTH_REQUIRED", { requestId: "r" });
    expect((await call()).status).toBe(401);
  });

  it("403 for a plain Admin", async () => {
    h.guard = async () => apiError("FORBIDDEN", { requestId: "r" });
    expect((await call()).status).toBe(403);
  });

  it("response never includes password_hash or any user fields", async () => {
    h.guard = async () => ({ username: "sa", name: "Super", role: "Admin", password_hash: "secret" });
    const body = await (await call()).json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["superAdmin"]);
  });
});
