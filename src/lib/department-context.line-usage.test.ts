import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// resolveDepartmentForLineUser trusts that the LINE id token was ALREADY verified and that the username comes from the LINE link
// (users.line_user_id), not from the request. It ignores sessions, tokens and requested departments, and only works in the default
// department. It must therefore be used by exactly one caller: the LIFF ordering gate (src/lib/line-liff-ordering.ts).
// Any other route that handles a LINE user (the webhook, other LIFF routes, mobile approvals) must NOT start using it by accident.

const ROOT = process.cwd();
const NAME = "resolveDepartmentForLineUser";
const ALLOWED = ["src/lib/department-context.ts"];
const FORBIDDEN = [
  "src/app/api/mobile/confirm/route.ts",
  "src/app/api/mobile/line-link/route.ts",
  "src/app/api/mobile/line-auth/route.ts",
  "src/app/api/line-webhook/route.ts",
  "src/lib/line-liff-auth.ts",
  "src/app/api/liff/orders/route.ts",
  "src/app/api/liff/orders/bootstrap/route.ts",
  "src/app/api/liff/orders/[id]/route.ts",
  "src/app/api/liff/orders/catalog/search/route.ts",
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

describe("resolveDepartmentForLineUser has a single caller", () => {
  it("is mentioned only by its definition and the LIFF ordering gate (any import style counts)", () => {
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
