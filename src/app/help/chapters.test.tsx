import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHAPTERS } from "./chapters";

const APP_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

describe("user manual chapters", () => {
  it("has unique chapter ids", () => {
    const ids = CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only describes pages that still exist (keeps the manual from going stale)", () => {
    const missing: string[] = [];
    for (const chapter of CHAPTERS) {
      for (const route of chapter.routes) {
        const pageFile = path.join(APP_DIR, route.replace(/^\//, ""), "page.tsx");
        if (!existsSync(pageFile)) missing.push(`${chapter.id}: ${route}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("renders every chapter to non-empty markup", () => {
    for (const chapter of CHAPTERS) {
      expect(renderToStaticMarkup(<>{chapter.body}</>).length, chapter.id).toBeGreaterThan(50);
    }
  });

  it("tells readers what to do when a menu is missing", () => {
    const menuChapter = CHAPTERS.find((chapter) => chapter.id === "menu-and-permissions");
    expect(menuChapter).toBeDefined();
    expect(renderToStaticMarkup(<>{menuChapter?.body}</>)).toContain("ผู้ดูแลระบบ");
  });

  it("every screenshot the manual shows exists in public/help", () => {
    const html = CHAPTERS.map((chapter) => renderToStaticMarkup(<>{chapter.body}</>)).join("\n");
    const sources = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    const missing = sources.filter((src) => !existsSync(path.join(PUBLIC_DIR, src)));
    expect(missing).toEqual([]);
  });

  it("every screenshot has Thai alt text", () => {
    const html = CHAPTERS.map((chapter) => renderToStaticMarkup(<>{chapter.body}</>)).join("\n");
    for (const img of html.match(/<img[^>]*>/g) ?? []) expect(img).toMatch(/alt="[^"]*[฀-๿][^"]*"/);
  });

  it("every chapter for a role says who to ask when the menu is missing", () => {
    const missing = CHAPTERS.filter((chapter) => chapter.audience !== "all")
      .filter((chapter) => !renderToStaticMarkup(<>{chapter.body}</>).includes("ผู้ดูแลระบบ"))
      .map((chapter) => chapter.id);
    expect(missing).toEqual([]);
  });

  it("never mentions Shipments (the feature is switched off: SHIPMENTS_ENABLED = false)", () => {
    for (const chapter of CHAPTERS) {
      expect(renderToStaticMarkup(<>{chapter.body}</>), chapter.id).not.toMatch(/shipment|receive\/vendor/i);
    }
  });

  it("every chapter names at least one page", () => {
    for (const chapter of CHAPTERS) expect(chapter.routes.length).toBeGreaterThan(0);
  });
});
