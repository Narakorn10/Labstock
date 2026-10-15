import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: (text: string) => unknown };
  sql.unsafe = (text: string) => text; // scoped-db column fragments
  return {
    sql,
    requireAccess: vi.fn(),
    normalize: vi.fn(),
    validate: vi.fn(),
    map: vi.fn((row) => row),
    hasAdvanced: vi.fn((body: unknown) => Boolean((body as { regex_pattern?: string })?.regex_pattern)),
  };
});

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/barcode-learning-auth", () => ({ requireBarcodeLearningV2Access: mocks.requireAccess }));
vi.mock("@/lib/barcode-learning-v2", () => ({
  hasBarcodeV2AdvancedRegexInput: mocks.hasAdvanced,
  mapBarcodeV2Row: mocks.map,
  normalizeV2Payload: mocks.normalize,
  validateBarcodeV2Payload: mocks.validate,
}));

import { POST } from "./route";

const normalizedPayload = {
  name: "Analyzer QR",
  mapping_mode: "CAPTURED_IDENTIFIER" as const,
  fixed_item_id: null,
  regex_pattern: "",
  item_id_group: null,
  lot_no_group: null,
  exp_date_group: null,
  examples: [{ raw_barcode: "A1", expected_item_id: "CHEM-001" }],
};

const validation = {
  regex_pattern: "^A1$",
  item_id_group: 1,
  lot_no_group: null,
  exp_date_group: null,
  verification: { status: "VERIFIED" as const, errors: [], warnings: [], checked_at: "2026-08-19T00:00:00.000Z" },
};

// Scope fragments (andDept / deptInsert) are tagged-template calls too, so find the statements by their text.
function statements() {
  return mocks.sql.mock.calls.map((call) => Array.from(call[0] as TemplateStringsArray).join(" "));
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/settings/barcode-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Barcode Learning V2 create API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.normalize.mockReturnValue(normalizedPayload);
    mocks.validate.mockResolvedValue(validation);
    mocks.requireAccess.mockResolvedValue({ response: null, user: { username: "admin", role: "Admin" } });
  });

  it("returns 403 before validation when a non-Admin supplies an advanced regex", async () => {
    mocks.requireAccess.mockResolvedValue({ response: null, user: { username: "manager", role: "Manager" } });

    const response = await POST(postRequest({ ...normalizedPayload, regex_pattern: "^A1$" }));

    expect(response.status).toBe(403);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(statements().filter((text) => text.includes("INSERT INTO"))).toEqual([]);
  });

  it("writes the pattern and CREATE audit record in one statement", async () => {
    mocks.sql.mockResolvedValue([{ id: 7, ...normalizedPayload, ...validation, created_at: new Date(), updated_at: new Date() }]);

    const response = await POST(postRequest(normalizedPayload));

    expect(response.status).toBe(201);
    const inserts = statements().filter((text) => text.includes("INSERT INTO barcode_pattern_v2 "));
    expect(inserts).toHaveLength(1);
    const statement = inserts[0];
    expect(statement).toContain("WITH created AS");
    expect(statement).toContain("INSERT INTO barcode_pattern_v2_audit");
    expect(statement).toContain("to_jsonb(created)");
  });
});
