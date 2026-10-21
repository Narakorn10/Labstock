import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, notifyUsers } from "@/lib/notifications";
import { type ExpiringSoonItem, type WeeklyLowStockItem, type WeeklyStockAlertPayload } from "@/lib/line-flex-templates";
import { ensureVendorNotificationSchema } from "@/lib/vendor-notification-utils";
import { departmentsReady } from "@/lib/departments-flag";
import { andDept, departmentErrorResponse, getDepartmentScope, type DepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";
import { positiveDepartmentId, staffOfDepartment, staffWithoutDepartment } from "@/lib/notification-departments";
import { itemsForVendor, splitRecipientsByVendor } from "@/lib/vendor-notification-scope";

type ExpiringItem = ExpiringSoonItem & { jobType: string; vendor: string };
// departmentId is only present in department mode (the legacy payload keeps exactly the original keys).
type WithDepartment<T> = T & { departmentId?: number | null };
type WeeklyAlerts = {
  lowStockItems: Array<WithDepartment<WeeklyLowStockItem>>;
  expiringSoonItems: Array<WithDepartment<ExpiringItem>>;
};

function getLineOrderUrl() {
  const explicitLiffUrl = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_URL?.trim();
  if (explicitLiffUrl) return explicitLiffUrl;

  const liffId = process.env.NEXT_PUBLIC_LINE_ORDER_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/liff/orders`;

  return undefined;
}

// Returns the scope the caller may notify for, or null when not authorized.
//  - valid cron secret (checked before any user lookup): every department; legacy while departments are off
//  - logged-in Admin/Manager: their own scope (a one-department Manager only notifies about that department)
async function authorize(request: Request): Promise<DepartmentScope | null> {
  const cronSecrets = [process.env.WEEKLY_STOCK_NOTIFICATION_CRON_SECRET, process.env.CRON_SECRET].filter((secret): secret is string => Boolean(secret));
  const requestSecret = request.headers.get("x-cron-secret");
  const authorization = request.headers.get("authorization");
  if (cronSecrets.some((secret) => requestSecret === secret || authorization === `Bearer ${secret}`)) {
    return (await departmentsReady()) ? { mode: "all" } : { mode: "legacy" };
  }
  const user = await getAuthenticatedUser(request);
  if (user?.role !== "Admin" && user?.role !== "Manager") return null;
  return getDepartmentScope(user);
}

async function getWeeklyAlerts(scope: DepartmentScope): Promise<WeeklyAlerts> {
  const departmentMode = scope.mode !== "legacy";
  const departmentColumn = departmentMode ? sql`, m.department_id AS "departmentId"` : sql``;
  const lowStockRows = await sql`
    WITH inventory_summary AS (
      SELECT item_id, SUM(quantity) AS current_qty FROM inventory GROUP BY item_id
    )
    SELECT m.item_id AS "itemId", m.name, m.unit, m.min_threshold AS "minThreshold",
      COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') AS "jobType", COALESCE(m.vendor, '') AS vendor,
      COALESCE(i.current_qty, 0) AS quantity${departmentColumn}
    FROM master_data m
    LEFT JOIN inventory_summary i ON i.item_id = m.item_id
    WHERE COALESCE(i.current_qty, 0) <= m.min_threshold${andDept(scope, "m")}
    ORDER BY "jobType", COALESCE(i.current_qty, 0), m.name
  `;
  const expiringRows = await sql`
    SELECT i.item_id AS "itemId", m.name, i.lot_no AS "lotNo", to_char(i.exp_date::date, 'YYYY-MM-DD') AS "expDate",
      i.quantity, m.unit, GREATEST(0, (i.exp_date::date - CURRENT_DATE))::int AS "daysUntilExpiry",
      COALESCE(NULLIF(m.job_type, ''), 'ไม่ระบุงาน') AS "jobType", COALESCE(m.vendor, '') AS vendor${departmentColumn}
    FROM inventory i
    JOIN master_data m ON m.item_id = i.item_id
    WHERE i.quantity > 0 AND i.exp_date IS NOT NULL
      AND i.exp_date::date >= CURRENT_DATE AND i.exp_date::date <= CURRENT_DATE + INTERVAL '30 days'${andDept(scope, "m")}
    ORDER BY i.exp_date ASC, "jobType", m.name
  `;
  // A missing/invalid department becomes null: such an item reaches no staff member (only its Vendor).
  const department = (item: { departmentId?: unknown }) => (departmentMode ? { departmentId: positiveDepartmentId(item.departmentId) } : {});
  return {
    lowStockItems: (lowStockRows as Array<WithDepartment<WeeklyLowStockItem>>).map((item) => ({ ...item, quantity: Number(item.quantity), minThreshold: Number(item.minThreshold), ...department(item) })),
    expiringSoonItems: (expiringRows as Array<WithDepartment<ExpiringItem>>).map((item) => ({ ...item, quantity: Number(item.quantity), daysUntilExpiry: Number(item.daysUntilExpiry), ...department(item) })),
  };
}

// The text must stay byte-identical to the original query when `extra` is empty (departments off); only the recipients
// differ per department, via `extra` (staffOfDepartment / staffWithoutDepartment).
function loadRecipients(extra: ReturnType<typeof sql>) {
  return sql`
      SELECT n.username, n.email, n.line_user_id, n.notify_weekly_summary, u.role, u.vendor
      FROM notification_settings n JOIN users u ON u.username = n.username
      WHERE n.notify_weekly_summary = true AND COALESCE(u.account_status, 'active') = 'active' AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)${extra}
    `;
}

// Department mode. Staff (every non-Vendor, Admin included) get one summary per department they are a member of, with
// that department's items only. Like legacy, the summary is sent even when a department has nothing to report. A
// non-Vendor without membership gets nothing (fail closed); only their number is logged. Returns the staff notified.
async function notifyStaffByDepartment(scope: DepartmentScope, alerts: WeeklyAlerts) {
  let departmentIds: number[];
  if (scope.mode === "one") {
    departmentIds = [scope.departmentId];
  } else {
    const memberships = await sql`
      SELECT DISTINCT ud.department_id AS "departmentId"
      FROM user_departments ud
      JOIN notification_settings n ON n.username = ud.username
      JOIN users u ON u.username = n.username
      WHERE n.notify_weekly_summary = true AND COALESCE(u.account_status, 'active') = 'active' AND (n.line_user_id IS NOT NULL OR n.email IS NOT NULL)
        AND COALESCE(u.role, '') <> 'Vendor'
      ORDER BY 1
    `;
    departmentIds = memberships.map((row) => positiveDepartmentId(row.departmentId)).filter((id): id is number => id !== null);
  }

  const notified = new Set<string>();
  for (const departmentId of departmentIds) {
    const staff = normalizeNotificationSettings(await loadRecipients(staffOfDepartment(departmentId)));
    if (staff.length === 0) continue;
    const payload: WeeklyStockAlertPayload = {
      lowStockItems: alerts.lowStockItems.filter((item) => item.departmentId === departmentId),
      expiringSoonItems: alerts.expiringSoonItems.filter((item) => item.departmentId === departmentId),
      orderUrl: getLineOrderUrl(),
    };
    await notifyUsers("WEEKLY_STOCK_ALERTS", payload, staff);
    staff.forEach((setting) => notified.add(setting.username));
  }

  const skipped = (await loadRecipients(staffWithoutDepartment())).length;
  if (skipped > 0) {
    console.warn(`[Notification] weekly-stock-summary: ${skipped} staff recipient(s) skipped because they belong to no department`);
  }
  return { notified: notified.size, skipped };
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const scope = await authorize(request);
    if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const departmentMode = scope.mode !== "legacy";
    await ensureVendorNotificationSchema();
    const alerts = await getWeeklyAlerts(scope);
    const recipientRows = await loadRecipients(sql``);
    let notifiedUsers = 0;
    let skippedUsers = 0;
    if (departmentMode) {
      const staff = await notifyStaffByDepartment(scope, alerts);
      notifiedUsers = staff.notified;
      skippedUsers = staff.skipped;
    } else {
      const generalRows = recipientRows.filter((row) => row.role !== "Vendor");
      const generalSettings = normalizeNotificationSettings(generalRows);
      if (generalSettings.length) await notifyUsers("WEEKLY_STOCK_ALERTS", { ...alerts, orderUrl: getLineOrderUrl() }, generalSettings);
      notifiedUsers = generalSettings.length;
    }

    // Vendors: one summary each, outside the department loop, with their own vendor's items among the items the scope
    // can see (cron: every department; a one-department Manager: that department only). TEMPORARY cross-department
    // policy, item 3 in docs/departments-rollout.md.
    let notifiedVendors = 0;
    // Fails closed: a Vendor whose vendor name is empty (NULL, "" or whitespace) is skipped and not counted. Names are compared
    // trimmed on both sides, so vendors that differ only by leading/trailing whitespace match.
    for (const { vendor, row } of splitRecipientsByVendor(recipientRows).vendors) {
      const vendorAlerts: WeeklyStockAlertPayload = {
        lowStockItems: itemsForVendor(alerts.lowStockItems, vendor),
        expiringSoonItems: itemsForVendor(alerts.expiringSoonItems, vendor),
      };
      await notifyUsers("WEEKLY_STOCK_ALERTS", vendorAlerts, normalizeNotificationSettings([row]));
      notifiedVendors += 1;
    }
    return NextResponse.json({
      success: true,
      notifiedUsers,
      notifiedVendors,
      lowStockItems: alerts.lowStockItems.length,
      expiringSoonItems: alerts.expiringSoonItems.length,
      ...(departmentMode ? { skippedUsers } : {}),
    });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    const message = error instanceof Error ? error.message : "Failed to send weekly stock alerts";
    console.error("Weekly stock summary notification error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
