import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExpiringSoonItem,
  LowStockItem,
  PurchaseOrder,
  TrackingResult,
  WeeklyStockAlertPayload,
  WeeklyStockSummaryItem,
  generateExpiringSoonTemplate,
  generateLowStockTemplate,
  generatePONotificationTemplate,
  generatePOStatusTemplate,
  generateTrackingTemplate,
  generateWeeklyStockAlertTemplates,
  generateWeeklyStockSummaryTemplate,
  poStatusLabel,
} from "./line-flex-templates";

const po: PurchaseOrder = {
  id: 407,
  po_number: "PO-20260928-0407",
  vendor: "Thai Clinical Trading",
  status: "PARTIALLY_SHIPPED",
  expected_date: "2026-10-05",
  items: [{ item_name: "Hematology Diluent 20 L", quantity: 4, unit: "ถัง" }],
};
const tracking: TrackingResult = {
  provider: "Thai Post", trackingNo: "TH123", status: "IN_TRANSIT", statusText: "กำลังจัดส่ง", lastUpdate: "2026-09-28T02:00:00Z",
  history: [{ timestamp: "2026-09-28T02:00:00Z", status: "ออกจากศูนย์", location: "กรุงเทพฯ", description: "" }],
};
const lowStock: LowStockItem = { itemId: "A", name: "Glucose HK", quantity: 1, minThreshold: 4, unit: "กล่อง" };
const expiring: ExpiringSoonItem = { itemId: "B", name: "Lyse 1 L", lotNo: "LY551", expDate: "2026-10-08", quantity: 1, unit: "ขวด", daysUntilExpiry: 10 };
const weeklyItem: WeeklyStockSummaryItem = { itemId: "C", name: "PT Reagent", quantity: 8, unit: "ขวด", weeklyTarget: 10, vendor: "Siam Diagnostics" };
const weekly: WeeklyStockAlertPayload = {
  lowStockItems: Array.from({ length: 12 }, (_, index) => ({ ...lowStock, itemId: `L${index}`, name: `Low ${index}`, jobType: "เคมีคลินิก", vendor: "V" })),
  expiringSoonItems: [{ ...expiring, jobType: "โลหิตวิทยา", vendor: "V" }],
  orderUrl: "https://liff.line.me/order",
};

const allMessages = () => [
  generatePONotificationTemplate(po),
  generatePOStatusTemplate(po),
  generatePOStatusTemplate(po, "⏰ Vendor ยังไม่ยืนยัน order"),
  generatePOStatusTemplate({ ...po, vendor: "", expected_date: null, items: undefined }),
  generateTrackingTemplate(tracking),
  generateLowStockTemplate([lowStock]),
  generateExpiringSoonTemplate([expiring]),
  generateWeeklyStockSummaryTemplate("Siam Diagnostics", [weeklyItem]),
  ...generateWeeklyStockAlertTemplates(weekly),
];

/** Visit every object/array in a Flex payload. */
function walk(node: unknown, visit: (value: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((child) => walk(child, visit));
  }
}

describe("Flex message templates", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://labstock.example"));
  afterEach(() => vi.unstubAllEnvs());

  it("uses #RRGGBB for every colour (LINE rejects oklch and named colours)", () => {
    const colorKeys = ["color", "backgroundColor", "borderColor"];
    for (const message of allMessages()) {
      walk(message, (value) => {
        for (const key of colorKeys) {
          if (key in value) expect(value[key], `${key}=${String(value[key])}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
      });
    }
  });

  it("never emits an empty text component (LINE rejects the whole message)", () => {
    for (const message of allMessages()) {
      walk(message, (value) => {
        if (value.type === "text") expect(String(value.text ?? "").length).toBeGreaterThan(0);
      });
    }
  });

  it("keeps every message inside the Flex size limits", () => {
    for (const message of allMessages()) {
      expect(String(message.altText).length).toBeGreaterThan(0);
      expect(String(message.altText).length).toBeLessThanOrEqual(400);
      expect(JSON.stringify(message).length).toBeLessThan(50_000);
      const contents = message.contents as { type: string; contents?: unknown[] };
      if (contents.type === "carousel") expect(contents.contents!.length).toBeLessThanOrEqual(12);
    }
  });

  describe("PO status card", () => {
    it("shows the Thai status instead of the raw code and links to the order", () => {
      const message = generatePOStatusTemplate(po);
      const text = JSON.stringify(message);

      expect(text).toContain("จัดส่งบางส่วน");
      expect(text).not.toContain("PARTIALLY_SHIPPED");
      expect(text).toContain("https://labstock.example/orders/407");
      expect(text).toContain(new Date("2026-10-05").toLocaleDateString("th-TH"));
    });

    it("keeps the reminder heading and the altText format used by the outbox", () => {
      const message = generatePOStatusTemplate(po, "⏰ Vendor ยังไม่ยืนยัน order");

      expect(message.altText).toBe("⏰ Vendor ยังไม่ยืนยัน order: PO-20260928-0407");
      expect(JSON.stringify(message)).toContain("⏰ Vendor ยังไม่ยืนยัน order");
      expect(generatePOStatusTemplate(po).altText).toBe("PO Status: PO-20260928-0407");
    });

    it("shows a dash for a missing or invalid expected date", () => {
      expect(JSON.stringify(generatePOStatusTemplate({ ...po, expected_date: null }))).toContain('"text":"-"');
      expect(JSON.stringify(generatePOStatusTemplate({ ...po, expected_date: "not a date" }))).not.toContain("Invalid Date");
    });

    it("falls back to the order number in the link when there is no id", () => {
      expect(JSON.stringify(generatePOStatusTemplate({ ...po, id: undefined }))).toContain("/orders/PO-20260928-0407");
    });
  });

  describe("poStatusLabel", () => {
    it("labels every status the app uses and passes unknown ones through", () => {
      expect(poStatusLabel("PENDING_MANAGER_REVIEW")).toBe("รอหัวหน้าตรวจ");
      expect(poStatusLabel("ACKNOWLEDGED")).toBe("Vendor รับทราบ");
      expect(poStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    });
  });

  describe("weekly stock alert", () => {
    it("builds a summary card, paged low-stock cards and an expiry card", () => {
      const messages = generateWeeklyStockAlertTemplates(weekly);
      // 1 summary + 12 low-stock items in 2 pages + 1 expiry page
      expect(messages).toHaveLength(4);
    });

    it("adds the open/order footer only when an order URL is given", () => {
      const withUrl = generateWeeklyStockAlertTemplates(weekly)[0];
      const without = generateWeeklyStockAlertTemplates({ ...weekly, orderUrl: undefined })[0];

      const footer = JSON.stringify((withUrl.contents as Record<string, unknown>).footer);
      expect(footer).toContain("เปิด LabStock");
      expect(footer).toContain("https://labstock.example/dashboard");
      expect(footer).toContain("https://liff.line.me/order");
      expect((without.contents as Record<string, unknown>).footer).toBeUndefined();
    });

    it("keeps the summary numbers", () => {
      const summary = JSON.stringify(generateWeeklyStockAlertTemplates(weekly)[0]);
      expect(summary).toContain("12 รายการ");
      expect(summary).toContain("1 lot");
    });
  });

  it("keeps the expiry acknowledge postback data the webhook parses", () => {
    const text = JSON.stringify(generateExpiringSoonTemplate([expiring]));
    expect(text).toContain("action=ack_expiry&itemId=B&lotNo=LY551&expDate=2026-10-08");
  });
});
