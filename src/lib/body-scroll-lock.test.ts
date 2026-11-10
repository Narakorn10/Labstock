import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Several overlays (dialog, popup, mobile menu) lock the page scroll. The lock must be counted, so closing them in any
// order never leaves the page stuck without scrolling.

const body = { style: { overflow: "" } };

beforeEach(() => {
  body.style.overflow = "";
  vi.stubGlobal("document", { body });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  return import("./body-scroll-lock");
}

describe("lockBodyScroll", () => {
  it("locks the page and restores it when released", async () => {
    const { lockBodyScroll } = await load();
    const unlock = lockBodyScroll();
    expect(body.style.overflow).toBe("hidden");
    unlock();
    expect(body.style.overflow).toBe("");
  });

  it("keeps the page locked until the last overlay is released, in any order", async () => {
    const { lockBodyScroll } = await load();
    const first = lockBodyScroll();
    const second = lockBodyScroll();
    first(); // the older overlay closes first
    expect(body.style.overflow).toBe("hidden");
    second();
    expect(body.style.overflow).toBe("");
  });

  it("restores the value the page had before the first lock", async () => {
    body.style.overflow = "scroll";
    const { lockBodyScroll } = await load();
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    b();
    a();
    expect(body.style.overflow).toBe("scroll");
  });

  it("ignores a second release of the same lock", async () => {
    const { lockBodyScroll } = await load();
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    a(); // must not release b's lock
    expect(body.style.overflow).toBe("hidden");
    b();
    expect(body.style.overflow).toBe("");
  });

  it("does nothing without a document (server render)", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("document", undefined);
    const { lockBodyScroll } = await load();
    expect(() => lockBodyScroll()()).not.toThrow();
  });
});
