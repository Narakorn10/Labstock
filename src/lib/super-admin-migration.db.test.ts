import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationFile, seedTwoDepartments } from "@/test/department-fixtures";
import { createPgliteSql, type PgliteSql } from "@/test/pglite-sql";

// v37 (users.is_super_admin) on the production schema + v30-v35, in an in-memory Postgres.

let migrated: PgliteSql;

const flagged = async () =>
  (await migrated.db.query<{ username: string }>("SELECT username FROM users WHERE is_super_admin ORDER BY username")).rows.map((row) => row.username);

beforeAll(async () => {
  migrated = createPgliteSql(new PGlite());
  await seedTwoDepartments(migrated);
  await migrated.db.exec(`
    INSERT INTO users (username, password_hash, name, role) VALUES
      ('5783', 'x', 'Super', 'Admin'),
      ('5783x', 'x', 'Lookalike', 'User');
  `);
}, 120_000);

afterAll(async () => {
  await migrated.db.close();
});

describe("upgrade_v37_super_admin.sql", () => {
  it("adds is_super_admin defaulting to false for every existing user", async () => {
    await applyMigrationFile(migrated.db, "upgrade_v37_super_admin.sql");
    expect(await flagged()).toEqual([]);
    const admin1 = await migrated.db.query<{ is_super_admin: boolean }>("SELECT is_super_admin FROM users WHERE username = 'admin1'");
    expect(admin1.rows).toEqual([{ is_super_admin: false }]);
  });

  it("is idempotent", async () => {
    await applyMigrationFile(migrated.db, "upgrade_v37_super_admin.sql");
    await expect(applyMigrationFile(migrated.db, "upgrade_v37_super_admin.sql")).resolves.toBeUndefined();
  });

  it("grant file sets only the named active Admin", async () => {
    await applyMigrationFile(migrated.db, "upgrade_v37_super_admin_grant.sql");
    expect(await flagged()).toEqual(["5783"]);
  });

  it("grant file does not promote a non-Admin named 5783", async () => {
    await migrated.db.exec("UPDATE users SET is_super_admin = false; UPDATE users SET role = 'User' WHERE username = '5783'");
    await applyMigrationFile(migrated.db, "upgrade_v37_super_admin_grant.sql");
    expect(await flagged()).toEqual([]);
  });

  it("rollback drops the column", async () => {
    await applyMigrationFile(migrated.db, "upgrade_v37_super_admin_rollback.sql");
    const cols = await migrated.db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_super_admin'");
    expect(cols.rows).toEqual([]);
  });
});
