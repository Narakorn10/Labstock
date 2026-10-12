// Shared shapes for the department switcher (step 6). No imports on purpose:
// both the server (`/api/auth/me`, `import type` only) and the client use this file.

/** A department the user can switch into (open, has a code, user is a member or Admin). */
export type DepartmentOption = {
  id: number;
  name: string;
  code: string;
};

/** Target of a switch: a department id, or "ALL" (read-only view for global Admin). */
export type SwitchTarget = number | "ALL";

/**
 * `departmentContext` key added to the `/api/auth/me` body when DEPARTMENTS_ENABLED and the schema is ready.
 * `options: null` means the list could not be loaded (fail closed, never a 500).
 */
export type DepartmentContext = {
  scope: number | "ALL";
  /** Current department; null while in the "ALL" view. `code` can be null (department without a code yet). */
  active: { id: number; name: string; code: string | null } | null;
  options: DepartmentOption[] | null;
  /** globalRole === "Admin" */
  canViewAll: boolean;
  /** scope === "ALL" */
  readOnly: boolean;
};
