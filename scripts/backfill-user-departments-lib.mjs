// One-off backfill: put every user who has NO room membership at all into the default room (code 'CC').
//
// Why this exists: migration v30 gave every user that existed THEN a user_departments row in CC. People who registered
// (or were created) after that have none, and department-aware login rejects a user without a membership. This fills
// them in. It must run ONCE, before DEPARTMENTS_ENABLED is turned on for the first time:
//   * it only adds users with no membership row at all, so nobody who already has any room is touched;
//   * it cannot tell "never got a room" from "was deliberately removed from every room", so after the flag is on a
//     person removed from their last room would be put back. (The app itself refuses to remove a person's last room.)
//   * do NOT re-run migration v30 for this: its backfill errors on users whose default room is not CC and re-adds
//     removed users (docs/departments-rollout.md item 5).
//
// `query(text, params)` is any async function that runs SQL on ONE connection (a transaction needs that) and returns
// the rows. Nothing here reads the environment or opens a connection; the CLI wrapper does that.

const countUserDepartments = async (query) => Number((await query("SELECT count(*)::int AS n FROM user_departments", []))[0].n);

const MISSING_SQL = `
  SELECT u.username
  FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM user_departments x WHERE x.username = u.username)
  ORDER BY u.username
`;

/**
 * @param {(text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>} query
 * @param {{ apply: boolean }} options  apply=false only reports and writes nothing.
 * @returns {Promise<{ applied: boolean, defaultRoomId: number, totalUsers: number, missing: string[], added: string[], before: number, after: number }>}
 */
export async function backfillUserDepartments(query, { apply }) {
  const rooms = await query("SELECT id FROM departments WHERE code = 'CC' AND is_active LIMIT 1", []);
  if (rooms.length === 0) throw new Error("No active department with code 'CC' (the default room). Run migration v30 first.");
  const defaultRoomId = Number(rooms[0].id);

  const totalUsers = Number((await query("SELECT count(*)::int AS n FROM users", []))[0].n);
  const before = await countUserDepartments(query);
  const missing = (await query(MISSING_SQL, [])).map((row) => String(row.username));

  if (!apply) return { applied: false, defaultRoomId, totalUsers, missing, added: [], before, after: before };

  await query("BEGIN", []);
  try {
    const inserted = await query(
      `INSERT INTO user_departments (username, department_id, role, is_default)
       SELECT u.username, $1, NULL, true
       FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM user_departments x WHERE x.username = u.username)
       ORDER BY u.username
       RETURNING username`,
      [defaultRoomId],
    );
    const added = inserted.map((row) => String(row.username));
    const after = await countUserDepartments(query);
    if (after - before !== added.length) throw new Error(`Row count check failed: ${before} -> ${after}, but ${added.length} rows were inserted. Rolled back.`);
    const doubleDefaults = await query(
      "SELECT username FROM user_departments WHERE is_default GROUP BY username HAVING count(*) > 1",
      [],
    );
    if (doubleDefaults.length > 0) throw new Error("A user would have two default rooms. Rolled back.");
    await query("COMMIT", []);
    return { applied: true, defaultRoomId, totalUsers, missing, added, before, after };
  } catch (error) {
    await query("ROLLBACK", []);
    throw error;
  }
}
