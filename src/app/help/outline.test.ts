import { describe, expect, it } from "vitest";
import { CHAPTERS } from "./chapters";
import { AUDIENCE_ORDER, buildOutline } from "./outline";

describe("user manual outline (table of contents)", () => {
  const outline = buildOutline(CHAPTERS);

  it("lists every chapter exactly once, so the table of contents is complete", () => {
    const listed = outline.flatMap((group) => group.chapters.map((item) => item.chapter.id));
    expect(listed.sort()).toEqual(CHAPTERS.map((chapter) => chapter.id).sort());
  });

  it("has one section per audience, in a fixed order", () => {
    expect(outline.map((group) => group.audience)).toEqual(AUDIENCE_ORDER);
    expect(outline.map((group) => group.number)).toEqual(["1", "2", "3", "4"]);
  });

  it("numbers chapters section.chapter without gaps or duplicates", () => {
    for (const group of outline) {
      group.chapters.forEach((item, index) => {
        expect(item.number).toBe(`${group.number}.${index + 1}`);
      });
    }
  });
});
