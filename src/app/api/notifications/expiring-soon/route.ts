import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, notifyUsers, notifyUsersVendorScoped } from "@/lib/notifications";
import { ExpiringSoonItem } from "@/lib/line-flex-templates";
import { departmentsReady } from "@/lib/departments-flag";
import { andDept, departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";
import { groupByDepartment, positiveDepartmentId, staffOfDepartment, staffWithoutDepartment } from "@/lib/notification-departments";
import { itemsForVendor, splitRecipientsByVendor } from "@/lib/vendor-notification-scope";

const ALERT_WINDOW_DAYS = 30;
const NOTIFICATION_TYPE = "EXPIRING_SOON_30D";

type ExpiringLot = ExpiringSoonItem & { departmentId?: number | null };

async function ensureExpiryNotificationSchema() {
  await sql`
    ALTER TABLE notification_settings
    ADD COLUMN IF NOT EXISTS notify_expiring_soon BOOLEAN DEFAULT true
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS expiry_notification_logs (
      id SERIAL PRIMARY KEY,
      item_id TEXT NOT NULL,
      lot_no TEXT NOT NULL,
      exp_date DATE NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'EXPIRING_SOON_30D',
      notified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by_line_user_id TEXT,
      UNIQUE (item_id, lot_no, exp_date, notification_type)
    )
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE expiry_notification_logs
    ADD COLUMN IF NOT EXISTS acknowledged_by_line_user_id TEXT
  `;
}

// Returns the scope the caller may notify for, or null when not authorized.
//  - valid cron secret: every department (a worker has no user); legacy while departments are off
//  - logged-in Admin: their own scope (viewing one department only notifies about that department's lots)
async function authorize(request: Request): Promise<DepartmentScope | null> {
  const cronSecret = process.env.EXPIRY_NOTIFICATION_CRON_SECRET;
  const requestSecret = request.headers.get("x-cron-secret");

  if (cronSecret && requestSecret === cronSecret) {
    return (await departmentsReady()) ? { mode: "all" } : { mode: "legacy" };
  }

  const user = await getAuthenticatedUser(request);
  if (user?.role !== "Admin") return null;
  return getDepartmentScope(user);
}

// The text must stay byte-identical to the original query when `extra` is empty (departments off); only the recipients
// differ per department, via `extra` (staffOfDepartment / staffWithoutDepartment).
function loadRecipients(extra: ReturnType<typeof sql>) {
  return sql`
      SELECT n.username, n.email, n.line_user_id, n.notify_expiring_soon, u.role, u.vendor
      FROM notification_settings n
      JOIN users u ON u.username = n.username
      WHERE n.notify_expiring_soon = true
        AND COALESCE(u.account_status, 'active') = 'active'
        AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)${extra}
    `;
}

async function logNotifiedLot(item: ExpiringLot) {
  await sql`
        INSERT INTO expiry_notification_logs (item_id, lot_no, exp_date, notification_type)
        VALUES (${item.itemId}, ${item.lotNo}, ${item.expDate}, ${NOTIFICATION_TYPE})
        ON CONFLICT (item_id, lot_no, exp_date, notification_type) DO NOTHING
      `;
}

// Department mode. Staff (every non-Vendor, Admin included) get one message per department they are a member of, with
// that department's lots only; a non-Vendor without membership gets nothing (fail closed). Vendors are sent ONCE, outside
// the department loop, with their own vendor's lots from every department (TEMPORARY policy, item 3 in
// docs/departments-rollout.md). A lot with a missing/invalid department reaches no staff member, only its Vendor.
//
// The log means "delivery was attempted" (notifyUsers swallows per-recipient send errors), and only lots that had at least
// one recipient are logged: a lot nobody could be told about stays unlogged so a later run (after a membership/vendor
// fix) still announces it. Legacy logs every lot, as before.
async function notifyByDepartment(items: ExpiringLot[], settingsRows: Array<Record<string, unknown>>) {
  const lotKey = (item: ExpiringLot) => JSON.stringify([item.itemId, item.lotNo, item.expDate]);
  const reached = new Set<string>();
  const notifiedUsers = new Set<string>();

  for (const [departmentId, departmentItems] of groupByDepartment(items)) {
    const staff = normalizeNotificationSettings(await loadRecipients(staffOfDepartment(departmentId)));
    if (staff.length === 0) continue;
    await notifyUsers("EXPIRING_SOON", departmentItems, staff);
    departmentItems.forEach((item) => reached.add(lotKey(item)));
    staff.forEach((setting) => notifiedUsers.add(setting.username));
  }

  for (const { vendor, row } of splitRecipientsByVendor(settingsRows).vendors) {
    const own = itemsForVendor(items, vendor);
    if (own.length === 0) continue;
    await notifyUsers("EXPIRING_SOON", own, normalizeNotificationSettings([row]));
    own.forEach((item) => reached.add(lotKey(item)));
    notifiedUsers.add(String(row.username));
  }

  const skippedRecipients = (await loadRecipients(staffWithoutDepartment())).length;
  if (skippedRecipients > 0) {
    console.warn(`[Notification] expiring-soon: ${skippedRecipients} staff recipient(s) skipped because they belong to no department`);
  }

  const notifiedLots = items.filter((item) => reached.has(lotKey(item)));
  for (const item of notifiedLots) {
    await logNotifiedLot(item);
  }

  return {
    success: true,
    notified: notifiedLots.length,
    recipients: notifiedUsers.size,
    skippedLots: items.length - notifiedLots.length,
    skippedRecipients,
  };
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const scope = await authorize(request);
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const departmentMode = scope.mode !== "legacy";

    await ensureExpiryNotificationSchema();

    const settingsRows = await loadRecipients(sql``);

    if (settingsRows.length === 0) {
      return NextResponse.json({
        success: true,
        notified: 0,
        skipped: "No recipients enabled for expiring-soon alerts"
      });
    }

    const itemsRows = await sql`
      SELECT
        i.item_id as "itemId",
        m.name,
        i.lot_no as "lotNo",
        to_char(i.exp_date::date, 'YYYY-MM-DD') as "expDate",
        i.quantity,
        m.unit,
        GREATEST(0, (i.exp_date::date - CURRENT_DATE))::int as "daysUntilExpiry",
        COALESCE(m.vendor, '') as vendor${departmentMode ? sql`, m.department_id AS "departmentId"` : sql``}
      FROM inventory i
      JOIN master_data m ON m.item_id = i.item_id
      WHERE i.quantity > 0
        AND i.exp_date IS NOT NULL
        AND i.exp_date::date >= CURRENT_DATE
        AND i.exp_date::date <= CURRENT_DATE + ${ALERT_WINDOW_DAYS} * INTERVAL '1 day'
        AND NOT EXISTS (
          SELECT 1
          FROM expiry_notification_logs log
          WHERE log.item_id = i.item_id
            AND log.lot_no = i.lot_no
            AND log.exp_date = i.exp_date::date
            AND log.notification_type = ${NOTIFICATION_TYPE}
        )${andDept(scope, "m")}
      ORDER BY i.exp_date ASC, m.name ASC
    `;

    // expDate is a "YYYY-MM-DD" string from to_char: the Neon driver would return a raw DATE as a JS Date, and String() of
    // that is not a valid date for the expiry_notification_logs INSERT.
    const items: ExpiringLot[] = itemsRows.map((row) => ({
      itemId: String(row.itemId),
      name: String(row.name),
      lotNo: String(row.lotNo),
      expDate: String(row.expDate),
      quantity: Number(row.quantity),
      unit: String(row.unit),
      daysUntilExpiry: Number(row.daysUntilExpiry),
      vendor: String(row.vendor ?? ""),
      ...(departmentMode ? { departmentId: positiveDepartmentId(row.departmentId) } : {}),
    }));

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        notified: 0,
        skipped: "No new lots expiring within 30 days"
      });
    }

    if (departmentMode) return NextResponse.json(await notifyByDepartment(items, settingsRows));

    await notifyUsersVendorScoped("EXPIRING_SOON", items, settingsRows);

    for (const item of items) {
      await logNotifiedLot(item);
    }

    return NextResponse.json({
      success: true,
      notified: items.length,
      recipients: settingsRows.length
    });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error("Expiring soon notification error:", error);
    const message = error instanceof Error ? error.message : "Failed to send expiring-soon alerts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
