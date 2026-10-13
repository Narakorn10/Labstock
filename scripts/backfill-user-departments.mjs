// One-off: give every user without any room membership the default room (CC). Run ONCE, before turning
// DEPARTMENTS_ENABLED on for the first time. Explanation and limits: see scripts/backfill-user-departments-lib.mjs
// and docs/departments-rollout.md item 5.
//
// Safety design (same as apply-migration.mjs):
//   * Does NOT load .env.local or any dotenv file. DATABASE_URL must already be in the process environment.
//   * Prints the target host (never the password).
//   * Default mode is a READ-ONLY report (who would be added). Nothing is written.
//   * Writing needs BOTH --apply and --confirm-host=<exact host>. It runs in one transaction with count checks.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/backfill-user-departments.mjs
//   DATABASE_URL=postgres://... node scripts/backfill-user-departments.mjs --apply --confirm-host=<host>
import { Client, neonConfig } from "@neondatabase/serverless";
import { backfillUserDepartments } from "./backfill-user-departments-lib.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmArg = args.find((arg) => arg.startsWith("--confirm-host="));
const confirmHost = confirmArg ? confirmArg.slice("--confirm-host=".length) : "";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail("DATABASE_URL is not set in the process environment (this script never reads .env files).");

let host;
try {
  host = new URL(connectionString).host;
} catch {
  fail("DATABASE_URL is not a valid URL.");
}

console.log(`Target host: ${host}`);
console.log(apply ? "Mode: APPLY (writes)" : "Mode: report only (read-only)");
if (apply && confirmHost !== host) {
  fail(`Refusing to write. Re-run with --confirm-host=${host} to confirm this is the intended database.`);
}

if (typeof WebSocket === "undefined") fail("This script needs a global WebSocket (Node 22+).");
neonConfig.webSocketConstructor = WebSocket;

// One connection: BEGIN / COMMIT must run on the same session.
const client = new Client({ connectionString });
await client.connect();
try {
  const result = await backfillUserDepartments(async (text, params) => (await client.query(text, params)).rows, { apply });
  console.log(`Users in total:                      ${result.totalUsers}`);
  console.log(`Memberships before:                  ${result.before}`);
  console.log(`Users with NO membership (to add):   ${result.missing.length}${result.missing.length ? `  -> ${result.missing.join(", ")}` : ""}`);
  if (result.applied) {
    console.log(`Added to the default room (id ${result.defaultRoomId}): ${result.added.length}${result.added.length ? `  -> ${result.added.join(", ")}` : ""}`);
    console.log(`Memberships after:                   ${result.after}`);
    console.log("Done.");
  } else {
    console.log("Nothing was written. Re-run with --apply --confirm-host=<host> to add them.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
