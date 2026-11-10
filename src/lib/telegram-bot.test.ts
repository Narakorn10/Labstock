import { describe, expect, it } from "vitest";
import { formatRecentLogsTelegramDigest } from "./telegram-bot";

// The digest is sent with parse_mode HTML: a < > & in a name, lot, user or action (for example the reason typed on a
// stock adjustment) must not break the message, because Telegram then refuses the whole text.

const entry = (overrides: Partial<Parameters<typeof formatRecentLogsTelegramDigest>[0][number]> = {}) => ({
  timestamp: "2026-11-10T03:00:00.000Z",
  action: "เบิกไปหน้างาน",
  itemId: "LAB-000001",
  name: "น้ำยา A",
  lotNo: "L1",
  qty: 2,
  user: "u1",
  ...overrides,
});

describe("formatRecentLogsTelegramDigest", () => {
  it("keeps the bold title and one line per log", () => {
    const text = formatRecentLogsTelegramDigest([entry(), entry({ action: "รับเข้าสต๊อกหลัก" })]);
    expect(text.startsWith("<b>LabStock Recent Logs</b>\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("เบิกไปหน้างาน");
  });

  it("escapes < > & in every text of a line so the HTML stays valid", () => {
    const text = formatRecentLogsTelegramDigest([
      entry({ action: "ปรับปรุง | เหตุผล: a<b & c>d", name: "X <b>bold</b> & Y", lotNo: "L<1>", user: "u&v" }),
    ]);
    const body = text.split("\n")[1];
    expect(body).toContain("a&lt;b &amp; c&gt;d");
    expect(body).toContain("X &lt;b&gt;bold&lt;/b&gt; &amp; Y");
    expect(body).toContain("Lot L&lt;1&gt;");
    expect(body).toContain("u&amp;v");
    expect(body).not.toMatch(/<(?!\/?b>)/); // no tag other than the title's <b>
    expect(body).not.toContain("<b>");
  });

  it("answers with the empty text when there is no log", () => {
    expect(formatRecentLogsTelegramDigest([])).toBe("<b>LabStock Recent Logs</b>\nNo recent log entries found.");
  });
});
