// Menus the Admin role must always keep, so an Admin can never lock themselves out
// of the landing page or of the Permissions screen that is needed to undo a mistake.
export const ADMIN_LOCKED_MENUS = ["dashboard", "rbac"] as const;

export function isLockedMenu(role: string, menuId: string): boolean {
  return role === "Admin" && (ADMIN_LOCKED_MENUS as readonly string[]).includes(menuId);
}

// Returns the locked menus that are missing from `allowedMenus` for this role (empty = OK).
export function findMissingLockedMenus(role: string, allowedMenus: unknown): string[] {
  if (role !== "Admin") return [];
  const menus = Array.isArray(allowedMenus) ? allowedMenus : [];
  return ADMIN_LOCKED_MENUS.filter((id) => !menus.includes(id));
}
