import { describe, expect, it, vi } from "vitest";

vi.mock("./auth-utils", () => ({ roleHasMenu: vi.fn() }));

import { resolveRichMenuId } from "./line-bot";

const env = {
  LINE_PURCHASING_RICH_MENU_ID: "purchasing-id",
  LINE_RECEIVE_RICH_MENU_ID: "receive-id",
  LINE_DISPENSE_RICH_MENU_ID: "dispense-id",
};

describe("resolveRichMenuId", () => {
  it("gives Admin and Manager the purchasing menu even when they can receive", () => {
    expect(resolveRichMenuId("Admin", true, env)).toBe("purchasing-id");
    expect(resolveRichMenuId("Manager", true, env)).toBe("purchasing-id");
  });

  it("gives roles with the receive menu the receive menu", () => {
    expect(resolveRichMenuId("User", true, env)).toBe("receive-id");
  });

  it("gives roles without receive (e.g. Operator) the dispense-only menu", () => {
    expect(resolveRichMenuId("Operator", false, env)).toBe("dispense-id");
  });

  it("falls back to the dispense menu when the receive menu id is not configured yet", () => {
    const withoutReceive = { ...env, LINE_RECEIVE_RICH_MENU_ID: undefined };
    expect(resolveRichMenuId("User", true, withoutReceive)).toBe("dispense-id");
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveRichMenuId("User", true, {})).toBeUndefined();
  });
});
