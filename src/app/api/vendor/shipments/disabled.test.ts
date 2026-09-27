import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), getAuthenticatedUser: vi.fn() }));

vi.mock("@/lib/db", () => ({ default: mocks.sql }));
vi.mock("@/lib/auth-utils", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/po-communication", () => ({ recordPurchaseOrderCommunication: vi.fn() }));

import { POST as shipPOST } from "./route";
import { PATCH as receivePATCH } from "./[id]/route";
import { POST as ocrPOST } from "./ocr/route";

describe("shipment routes while shipments are disabled", () => {
  it("rejects creating, OCR-reading and receiving shipments without touching the database", async () => {
    const request = () => new Request("http://test", { method: "POST", body: "{}" });

    const responses = [
      await shipPOST(request()),
      await ocrPOST(request()),
      await receivePATCH(request(), { params: Promise.resolve({ id: "1" }) }),
    ];

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });
});
