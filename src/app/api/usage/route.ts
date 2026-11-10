import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { clampToToday } from "@/lib/bangkok-date";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getReagentUsageInsights } from "@/lib/reagent-usage-insights";
import { getRefillOrUnavailable } from "@/lib/real-usage";
import { isReasonableIsoDate } from "@/lib/local-date";
import { andDept, departmentErrorResponse, getDepartmentScope } from "@/lib/scoped-db";
import { getRequestId } from "@/lib/request-observability";

type SummaryItem = {
  itemId: string;
  name: string;
  dispensed: string | number;
  received: string | number;
  adjusted: string | number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const daysBetween = (startDate: string, endDate: string) =>
  Math.max(1, Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1);

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scope = await getDepartmentScope(user);

    const { searchParams } = new URL(request.url);
    const startDate = (searchParams.get("startDate") || "").trim();
    const requestedEnd = (searchParams.get("endDate") || "").trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(requestedEnd)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }
    if (!isReasonableIsoDate(startDate)) {
      return NextResponse.json({ error: "Invalid start date. Use a real date from the year 2000 on" }, { status: 400 });
    }
    // A day in the future has no usage yet: cut the end to today (Thai time); a start after that is an error.
    const endDate = clampToToday(requestedEnd);
    if (startDate > endDate) {
      return NextResponse.json({ error: "Invalid date range. Start date is after today or after the end date" }, { status: 400 });
    }

    const summaryRows = await sql`
      SELECT
        item_id AS "itemId",
        MAX(name) AS name,
        SUM(CASE WHEN action = 'เบิกไปหน้างาน' THEN quantity ELSE 0 END) AS dispensed,
        SUM(CASE WHEN action = 'รับเข้าสต๊อกหลัก' THEN quantity ELSE 0 END) AS received,
        SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) AS adjusted
      FROM logs
      WHERE timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
      GROUP BY item_id
    `;
    const summary = (summaryRows as unknown as SummaryItem[]).map((row) => ({
      ...row,
      dispensed: Number(row.dispensed) || 0,
      received: Number(row.received) || 0,
      adjusted: Number(row.adjusted) || 0
    }));

    if (user.role !== "Admin" && user.role !== "Manager") {
      return NextResponse.json({ summary });
    }

    const [dailyRows, weeklyStats, slowMoving, insightData, refillResult, firstLogRows] = await Promise.all([
      sql`
        SELECT
          TO_CHAR(timestamp AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS date,
          item_id AS "itemId",
          SUM(quantity) AS qty
        FROM logs
        WHERE action = 'เบิกไปหน้างาน'
          AND timestamp >= (${startDate}::date)::timestamp AT TIME ZONE 'Asia/Bangkok'
          AND timestamp < (${endDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'${andDept(scope)}
        GROUP BY date, item_id
        ORDER BY date ASC
      `,
      sql`
        SELECT
          TO_CHAR(DATE_TRUNC('week', timestamp), 'YYYY-"W"IW') AS week,
          SUM(quantity) AS "totalDispensed"
        FROM logs
        WHERE action = 'เบิกไปหน้างาน'
          AND timestamp >= ${startDate}::date
          AND timestamp < (${endDate}::date + INTERVAL '1 day')${andDept(scope)}
        GROUP BY week
        ORDER BY week ASC
      `,
      sql`
        SELECT m.item_id AS "itemId", m.name, SUM(i.quantity) AS stock
        FROM master_data m
        JOIN inventory i ON m.item_id = i.item_id${andDept(scope, "i")}
        WHERE m.item_id NOT IN (
          SELECT DISTINCT l.item_id FROM logs l
          WHERE l.action = 'เบิกไปหน้างาน'
            AND l.timestamp >= CURRENT_DATE - INTERVAL '30 days'${andDept(scope, "l")}
        )${andDept(scope, "m")}
        GROUP BY m.item_id, m.name
        HAVING SUM(i.quantity) > 0
        ORDER BY stock DESC
        LIMIT 5
      `,
      getReagentUsageInsights(scope),
      getRefillOrUnavailable(scope, startDate, endDate),
      sql`
        SELECT TO_CHAR(MIN(timestamp) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS "firstLogDate"
        FROM logs
        WHERE TRUE${andDept(scope)}
      `
    ]);

    // Refill rows carry the master item id. Items are matched by lower-cased id and shown with that id everywhere
    // (summary, items and itemsRefill), so a reagent never appears twice because of letter case.
    const canonicalId = new Map<string, string>();
    for (const refillRow of refillResult.rows) canonicalId.set(refillRow.itemId.toLowerCase(), refillRow.itemId);
    const canon = (itemId: string) => canonicalId.get(itemId.toLowerCase()) ?? itemId;

    type DayStat = {
      date: string;
      totalDispensed: number;
      totalRefill: number;
      totalUsage: number;
      items: Record<string, number>;
      itemsRefill: Record<string, number>;
    };
    const dailyStats: Record<string, DayStat> = {};
    const dayOf = (date: string) => (dailyStats[date] ??= { date, totalDispensed: 0, totalRefill: 0, totalUsage: 0, items: {}, itemsRefill: {} });
    for (const row of dailyRows as Array<{ date: string; itemId: string; qty: string | number }>) {
      const day = dayOf(row.date);
      const qty = Number(row.qty) || 0;
      const itemId = canon(row.itemId);
      day.totalDispensed += qty;
      day.items[itemId] = (day.items[itemId] || 0) + qty;
    }
    const refillByItem = new Map<string, { name: string; refill: number }>();
    for (const refillRow of refillResult.rows) {
      const day = dayOf(refillRow.date);
      day.totalRefill = round2(day.totalRefill + refillRow.qty);
      day.itemsRefill[refillRow.itemId] = round2((day.itemsRefill[refillRow.itemId] || 0) + refillRow.qty);
      const entry = refillByItem.get(refillRow.itemId.toLowerCase()) ?? { name: refillRow.name, refill: 0 };
      entry.refill = round2(entry.refill + refillRow.qty);
      refillByItem.set(refillRow.itemId.toLowerCase(), entry);
    }
    for (const day of Object.values(dailyStats)) day.totalUsage = round2(day.totalDispensed + day.totalRefill);

    // Log rows are grouped by the exact item_id, so 'R1' and 'r1' arrive as two rows. Merge them per lower-cased id
    // before the refill is attached, otherwise each row would get the whole refill and the usage would be counted twice.
    const mergedSummary = new Map<string, SummaryItem & { dispensed: number; received: number; adjusted: number }>();
    for (const row of summary) {
      const key = row.itemId.toLowerCase();
      const entry = mergedSummary.get(key);
      if (entry) {
        entry.dispensed += row.dispensed;
        entry.received += row.received;
        entry.adjusted += row.adjusted;
      } else {
        mergedSummary.set(key, { ...row });
      }
    }
    const usageSummary = [...mergedSummary.values()].map((row) => {
      const refill = refillByItem.get(row.itemId.toLowerCase())?.refill ?? 0;
      return { ...row, itemId: canon(row.itemId), refill, usage: round2(row.dispensed + refill) };
    });
    const summarized = new Set(summary.map((row) => row.itemId.toLowerCase()));
    for (const [key, entry] of refillByItem) {
      if (summarized.has(key)) continue; // refill of an item with no log in range still gets a row
      usageSummary.push({ itemId: canonicalId.get(key) ?? key, name: entry.name, dispensed: 0, received: 0, adjusted: 0, refill: entry.refill, usage: entry.refill });
    }

    // "All" starts at the oldest log or at the earliest day the first count's refill was spread over, whichever is older.
    const firstLogOnly = (firstLogRows as unknown as Array<{ firstLogDate: string | null }>)[0]?.firstLogDate ?? null;
    const firstLogDate = firstLogOnly && refillResult.firstSpreadDate
      ? (refillResult.firstSpreadDate < firstLogOnly ? refillResult.firstSpreadDate : firstLogOnly)
      : firstLogOnly ?? refillResult.firstSpreadDate;

    return NextResponse.json({
      summary: usageSummary,
      dailyStats: Object.values(dailyStats).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      lastCountDate: refillResult.lastCountDate,
      lastCountByItem: refillResult.lastCountByItem,
      ...(refillResult.unavailable ? { refillUnavailable: true } : {}),
      range: { startDate, endDate, days: daysBetween(startDate, endDate) },
      firstLogDate,
      weeklyStats,
      slowMoving,
      insights: insightData.insights,
      expiryRisks: insightData.expiryRisks
    });
  } catch (error: unknown) {
    const departmentResponse = departmentErrorResponse(error, requestId);
    if (departmentResponse) return departmentResponse;
    console.error("Usage API Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
