// Client-side calls for the department switcher (step 6). Uses fetch directly, NOT api-client (axios):
// api-client attaches a Bearer token (the switch route rejects Bearer) and signs the user out on 401.
// Nothing here throws, signs out or redirects.
import { fetchErrorShape, parseApiError } from "@/lib/api-errors-client";
import {
  parseDepartmentContext,
  resolveSwitchOutcome,
  SWITCH_FALLBACK_MESSAGE,
  type DepartmentContext,
  type SwitchOutcome,
  type SwitchPostResult,
  type SwitchTarget,
} from "@/lib/department-switcher-state";

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchImpl = (input, init) => fetch(input, init);

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function networkFailure(): SwitchPostResult {
  const error = parseApiError({ isAxiosError: true }, SWITCH_FALLBACK_MESSAGE);
  return { status: 0, code: "NETWORK_OFFLINE", error };
}

/** POST /api/session/department with body `{departmentId}` only. Cookie auth, no Authorization header. Never throws. */
export async function postDepartmentSwitch(
  target: SwitchTarget,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<SwitchPostResult> {
  if (!(target === "ALL" || (typeof target === "number" && Number.isInteger(target)))) {
    return { status: 0, code: "INVALID_TARGET", error: { message: SWITCH_FALLBACK_MESSAGE, code: "INVALID_TARGET" } };
  }
  try {
    const response = await fetchImpl("/api/session/department", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: target }),
    });
    const status = response.status;
    const body = await readJson(response);
    if (response.ok) {
      const code = typeof (body as { code?: unknown } | null)?.code === "string" ? (body as { code: string }).code : "";
      return { status, code };
    }
    const error = parseApiError(fetchErrorShape(status, body), SWITCH_FALLBACK_MESSAGE);
    return { status, code: error.code, error };
  } catch {
    return networkFailure();
  }
}

/** Post the switch and turn the answer into the value the UI needs: "reload" | "hide" | { error }. Never throws. */
export async function switchDepartment(target: SwitchTarget, fetchImpl: FetchImpl = defaultFetch): Promise<SwitchOutcome> {
  try {
    return resolveSwitchOutcome(await postDepartmentSwitch(target, fetchImpl));
  } catch {
    return resolveSwitchOutcome(networkFailure());
  }
}

/**
 * GET /api/auth/me for the "retry" button. Returns the parsed context (null = the server sent none),
 * or undefined when the call failed (non-2xx / network / bad JSON): the caller keeps what it has.
 * No signOut path here.
 */
export async function fetchDepartmentContext(
  fetchImpl: FetchImpl = defaultFetch,
): Promise<DepartmentContext | null | undefined> {
  try {
    const response = await fetchImpl("/api/auth/me", { method: "GET", credentials: "same-origin" });
    if (!response.ok) return undefined;
    const body = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    return parseDepartmentContext((body as { departmentContext?: unknown }).departmentContext);
  } catch {
    return undefined;
  }
}
