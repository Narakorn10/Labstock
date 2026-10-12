import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// resolveDepartmentForVerifiedUser trusts that the identity was already verified (PIN / LINE) and ignores sessions,
// tokens and requested departments. It must therefore be used by exactly one caller: /api/mobile/confirm.
// Any other route that verified a user some other way must NOT start using it by accident.

const ROOT = process.cwd();
const NAME = "resolveDepartmentForVerifiedUser";
const ALLOWED = ["src/app/api/mobile/confirm/route.ts", "src/lib/department-context.ts"];
const FORBIDDEN = [
  "src/app/api/mobile/line-link/route.ts",
  "src/app/api/stations/authorize-user/route.ts",
  "src/app/api/mobile/line-auth/route.ts",
  "src/app/api/line-webhook/route.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(path.join(ROOT, "src"))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
  .sort();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("resolveDepartmentForVerifiedUser has a single caller", () => {
  it("is mentioned only by its definition and /api/mobile/confirm (any import style counts)", () => {
    const mentions = sourceFiles.filter((rel) => read(rel).includes(NAME)).sort();
    expect(mentions).toEqual(ALLOWED);
  });

  it("is not re-exported or namespace-imported from department-context in any non-test file", () => {
    const reexport = /export\s+\*\s+from\s+["'][^"']*department-context["']/;
    const namespaceImport = /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*department-context["']/;
    const offenders = sourceFiles.filter((rel) => {
      const text = read(rel);
      return reexport.test(text) || namespaceImport.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it.each(FORBIDDEN)("%s exists and does not use it", (rel) => {
    expect(sourceFiles).toContain(rel);
    expect(read(rel)).not.toContain(NAME);
  });
});
