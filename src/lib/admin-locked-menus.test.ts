import { describe, expect, it } from "vitest";
import { findMissingLockedMenus, isLockedMenu } from "./admin-locked-menus";

describe("admin locked menus", () => {
  it("locks dashboard and rbac for Admin only", () => {
    expect(isLockedMenu("Admin", "rbac")).toBe(true);
    expect(isLockedMenu("Admin", "dashboard")).toBe(true);
    expect(isLockedMenu("Admin", "master_data")).toBe(false);
    expect(isLockedMenu("Manager", "rbac")).toBe(false);
  });

  it("reports which locked menus an Admin save would remove", () => {
    expect(findMissingLockedMenus("Admin", ["dashboard", "rbac", "settings"])).toEqual([]);
    expect(findMissingLockedMenus("Admin", ["dashboard", "settings"])).toEqual(["rbac"]);
    expect(findMissingLockedMenus("Admin", [])).toEqual(["dashboard", "rbac"]);
  });

  it("treats a missing or non-array menu list as empty for Admin", () => {
    expect(findMissingLockedMenus("Admin", undefined)).toEqual(["dashboard", "rbac"]);
    expect(findMissingLockedMenus("Admin", "rbac")).toEqual(["dashboard", "rbac"]);
  });

  it("does not restrict other roles", () => {
    expect(findMissingLockedMenus("Manager", [])).toEqual([]);
    expect(findMissingLockedMenus("Vendor", undefined)).toEqual([]);
  });
});
