// Applies ONE .sql migration file statement-by-statement (required for CREATE INDEX CONCURRENTLY).
//
// Safety design:
//   * Does NOT load .env.local or any dotenv file. DATABASE_URL must already be in the process environment.
//   * Prints the target host (never the password) and REFUSES to run unless --confirm-host=<exact host> matches.
//   * --dry-run prints the statements and exits without connecting.
//   * Stops at the first error and prints which statement failed. Migrations are written to be idempotent,
//     so after fixing the cause you can simply run the same file again.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/apply-migration.mjs upgrade_v31_department_columns.sql --dry-run
//   DATABASE_URL=postgres://... node scripts/apply-migration.mjs upgrade_v31_department_columns.sql --confirm-host=<host>
import { readFileSync } from "node:fs";
import { Client, neonConfig } from "@neondatabase/serverless";
import { splitSqlStatements } from "./sql-statements.mjs";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const confirmArg = args.find((arg) => arg.startsWith("--confirm-host="));
const confirmHost = confirmArg ? confirmArg.slice("--confirm-host=".length) : "";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!file) {
  fail("Usage: node scripts/apply-migration.mjs <file.sql> [--dry-run] [--confirm-host=<host>]");
}

const statements = splitSqlStatements(readFileSync(file, "utf8"));

if (dryRun) {
  console.log(`-- dry run: ${statements.length} statement(s) from ${file}`);
  statements.forEach((statement, index) => {
    console.log(`\n-- [${index + 1}/${statements.length}]\n${statement};`);
  });
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail("DATABASE_URL is not set in the process environment (this script never reads .env files).");
}

let host;
try {
  host = new URL(connectionString).host;
} catch {
  fail("DATABASE_URL is not a valid URL.");
}

console.log(`Target host: ${host}`);
console.log(`File: ${file} (${statements.length} statements)`);
if (confirmHost !== host) {
  fail(`Refusing to run. Re-run with --confirm-host=${host} to confirm this is the intended database.`);
}

if (typeof WebSocket === "undefined") {
  fail("This script needs a global WebSocket (Node 22+).");
}
neonConfig.webSocketConstructor = WebSocket;

// A single connection keeps session settings such as SET lock_timeout in effect for the whole file.
const client = new Client({ connectionString });
await client.connect();
let index = 0;
try {
  for (const statement of statements) {
    index++;
    await client.query(statement);
    console.log(`ok [${index}/${statements.length}] ${statement.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  console.log("Done.");
} catch (error) {
  console.error(`FAILED at statement ${index}/${statements.length}:\n${statements[index - 1]}\n`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
