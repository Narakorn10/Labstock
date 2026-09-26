import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("./db", () => ({ default: mocks.sql }));

import { comparePassword, isLegacyPasswordHash, upgradeLegacyPasswordHash } from "./auth-utils";

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
