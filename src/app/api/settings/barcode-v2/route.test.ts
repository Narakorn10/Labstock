import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  requireAccess: vi.fn(),
  normalize: vi.fn(),
  validate: vi.fn(),
  map: vi.fn((row) => row),
  hasAdvanced: vi.fn((body: unknown) => Boolean((body as { regex_pattern?: string })?.regex_pattern)),
}));

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
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("writes the pattern and CREATE audit record in one statement", async () => {
    mocks.sql.mockResolvedValue([{ id: 7, ...normalizedPayload, ...validation, created_at: new Date(), updated_at: new Date() }]);

    const response = await POST(postRequest(normalizedPayload));

    expect(response.status).toBe(201);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    const statement = Array.from(mocks.sql.mock.calls[0][0] as TemplateStringsArray).join(" ");
    expect(statement).toContain("WITH created AS");
    expect(statement).toContain("INSERT INTO barcode_pattern_v2_audit");
    expect(statement).toContain("to_jsonb(created)");
  });
});
