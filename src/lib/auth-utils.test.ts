import bcrypt from "bcryptjs";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("./db", () => ({ default: mocks.sql }));

import { comparePassword, DUMMY_PIN_HASH, hashPassword, isLegacyPasswordHash, roleHasMenu, upgradeLegacyPasswordHash, verifyUserPin } from "./auth-utils";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

describe("legacy password hash upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sql.mockResolvedValue([]);
  });

  it("detects legacy SHA-256 hashes", () => {
    expect(isLegacyPasswordHash(sha256("secret"))).toBe(true);
    expect(isLegacyPasswordHash("$2b$10$abcdefghijklmnopqrstuv")).toBe(false);
  });

  it("re-hashes a legacy password with bcrypt and guards on the old hash", async () => {
    const oldHash = sha256("secret");
    await upgradeLegacyPasswordHash("staff", "secret", oldHash);

    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const values = mocks.sql.mock.calls[0].slice(1) as string[];
    const [newHash, username, guardHash] = values;
    expect(newHash.startsWith("$2")).toBe(true);
    expect(await comparePassword("secret", newHash)).toBe(true);
    expect(username).toBe("staff");
    expect(guardHash).toBe(oldHash);
  });

  it("does nothing for a bcrypt hash", async () => {
    await upgradeLegacyPasswordHash("staff", "secret", "$2b$10$abcdefghijklmnopqrstuv");
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("never throws when the database update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sql.mockRejectedValue(new Error("db down"));
    await expect(upgradeLegacyPasswordHash("staff", "secret", sha256("secret"))).resolves.toBeUndefined();
  });
});

describe("roleHasMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always allows Admin without querying the database", async () => {
    await expect(roleHasMenu("Admin", "receive")).resolves.toBe(true);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("allows a role whose allowed_menus contains the menu", async () => {
    mocks.sql.mockResolvedValue([{ allowed_menus: ["dashboard", "dispense"] }]);
    await expect(roleHasMenu("Operator", "dispense")).resolves.toBe(true);
  });

  it("denies a role whose allowed_menus lacks the menu, or has no row", async () => {
    mocks.sql.mockResolvedValueOnce([{ allowed_menus: ["dashboard"] }]);
    await expect(roleHasMenu("Operator", "receive")).resolves.toBe(false);
    mocks.sql.mockResolvedValueOnce([]);
    await expect(roleHasMenu("Ghost", "receive")).resolves.toBe(false);
  });

  it("denies when the permission lookup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sql.mockRejectedValue(new Error("db down"));
    await expect(roleHasMenu("Operator", "receive")).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe("verifyUserPin timing equalization", () => {
  let pinHash: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    pinHash = await hashPassword("1234");
  });

  // hasUserPinColumn, hasUserAccountStatusColumn, then the user lookup.
  const lookup = (users: Array<Record<string, unknown>>) => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValueOnce([{ exists: true }]).mockResolvedValueOnce([{ exists: true }]).mockResolvedValueOnce(users);
  };

  it("uses a valid bcrypt cost-10 dummy hash", () => {
    expect(DUMMY_PIN_HASH).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
    expect(bcrypt.getRounds(DUMMY_PIN_HASH)).toBe(10);
    expect(bcrypt.getRounds(pinHash)).toBe(bcrypt.getRounds(DUMMY_PIN_HASH));
  });

  it.each([
    ["an unknown user", [] as Array<Record<string, unknown>>],
    ["an inactive user", [{ username: "u", name: "U", role: "User", pin_hash: "<set below>", account_status: "disabled" }]],
    ["a user without a PIN", [{ username: "u", name: "U", role: "User", pin_hash: null, account_status: "active" }]],
  ])("runs exactly one bcrypt compare and returns null for %s", async (_label, users) => {
    if (users[0]?.account_status === "disabled") users[0].pin_hash = pinHash;
    lookup(users);
    const compare = vi.spyOn(bcrypt, "compare");
    await expect(verifyUserPin("u", "1234")).resolves.toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith("1234", DUMMY_PIN_HASH);
  });

  it("runs exactly one bcrypt compare and returns null for a wrong PIN", async () => {
    lookup([{ username: "u", name: "U", role: "User", pin_hash: pinHash, account_status: "active" }]);
    const compare = vi.spyOn(bcrypt, "compare");
    await expect(verifyUserPin("u", "0000")).resolves.toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith("0000", pinHash);
  });

  it("returns the user after exactly one bcrypt compare for the correct PIN", async () => {
    lookup([{ username: "u", name: "U", role: "User", vendor: null, pin_hash: pinHash, account_status: "active" }]);
    const compare = vi.spyOn(bcrypt, "compare");
    await expect(verifyUserPin("u", "1234")).resolves.toEqual({ username: "u", name: "U", role: "User", vendor: null });
    expect(compare).toHaveBeenCalledTimes(1);
  });
});
