import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Many test files start an in-memory Postgres (PGlite); when they all run in parallel a single test can exceed the
  // 5 s default on a loaded machine even though it takes ~50 ms alone.
  test: { testTimeout: 20_000, hookTimeout: 60_000 },
});
