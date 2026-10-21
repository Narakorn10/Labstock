import type { PgliteSql } from "@/test/pglite-sql";
import { DEPT_A, DEPT_B } from "@/test/department-fixtures";

// Shared fixtures for the department tests of the notification crons (expiring-soon, vendor-low-stock, weekly-stock-summary).
// Run AFTER seedTwoDepartments(sql). notification_settings is not part of the production DDL used by the fixtures, so it is
// created here (the routes only ADD COLUMN IF NOT EXISTS to it).
//
// Items (all below the min threshold with no stock; every other item in the seed gets threshold -1 so it is never "low"):
//   N-A1  dept A, Vendor A      N-A2  dept A, Vendor B
//   N-B1  dept B, Vendor A      N-B2  dept B, Vendor B
// Recipients (line_user_id = "U-<username>", every notify_* flag on):
//   solo1 A | solo2 B | user1 A+B | admin1 Admin A | adminNone Admin without membership | newbie User without membership
//   vendA Vendor "Vendor A" | vendB Vendor "Vendor B"
export const NOTIFY_ITEMS = ["N-A1", "N-A2", "N-B1", "N-B2"];

export async function addNotificationFixtures(sql: PgliteSql) {
  await sql.db.exec(`
    CREATE TABLE notification_settings (
      username TEXT PRIMARY KEY, email TEXT, line_user_id TEXT,
      notify_po_created BOOLEAN, notify_po_confirmed BOOLEAN, notify_po_shipped BOOLEAN, notify_po_received BOOLEAN,
      notify_low_stock BOOLEAN DEFAULT true, notify_expiring_soon BOOLEAN DEFAULT true, notify_weekly_summary BOOLEAN DEFAULT true
    );
    INSERT INTO users (username, password_hash, name, role, vendor) VALUES
      ('adminNone', 'x', 'Admin No Membership', 'Admin', ''),
      ('vendA', 'x', 'Vendor A Account', 'Vendor', 'Vendor A'),
      ('vendB', 'x', 'Vendor B Account', 'Vendor', 'Vendor B');
    INSERT INTO notification_settings (username, line_user_id)
      SELECT username, 'U-' || username FROM users WHERE username IN
        ('solo1', 'solo2', 'user1', 'admin1', 'adminNone', 'newbie', 'vendA', 'vendB');
    UPDATE master_data SET min_threshold = -1;
    INSERT INTO master_data (item_id, name, unit, vendor, min_threshold, job_type, department_id) VALUES
      ('N-A1', 'Item A1', 'box', 'Vendor A', 5, NULL, ${DEPT_A}),
      ('N-A2', 'Item A2', 'box', 'Vendor B', 5, NULL, ${DEPT_A}),
      ('N-B1', 'Item B1', 'kit', 'Vendor A', 5, NULL, ${DEPT_B}),
      ('N-B2', 'Item B2', 'kit', 'Vendor B', 5, NULL, ${DEPT_B});
  `);
}

/** Item ids carried by a recorded message: a list of items, or the two lists of a weekly summary payload. */
export function itemIdsOf(data: unknown): string[] {
  const ids = (list: unknown) => (Array.isArray(list) ? list.map((item) => String((item as { itemId: unknown }).itemId)).sort() : []);
  if (Array.isArray(data)) return ids(data);
  const weekly = data as { lowStockItems?: unknown; expiringSoonItems?: unknown };
  return [...ids(weekly.lowStockItems).map((id) => `low:${id}`), ...ids(weekly.expiringSoonItems).map((id) => `exp:${id}`)];
}

/** Who received which item ids: { username: [message1 ids, message2 ids, ...] } from the recorded LINE pushes (line_user_id = "U-<username>"). */
export function messagesByUser(calls: Array<{ args: unknown[] }>): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  for (const call of calls) {
    const username = String(call.args[0]).replace(/^U-/, "");
    // pushWeeklyStockSummary takes (lineUserId, vendor, items); every other push takes (lineUserId, payload)
    const data = call.args.length > 2 ? call.args[2] : call.args[1];
    (out[username] ??= []).push(itemIdsOf(data));
  }
  return out;
}
