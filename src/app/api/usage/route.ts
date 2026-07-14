import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { getReagentUsageInsights } from "@/lib/reagent-usage-insights";

type SummaryItem = {
  itemId: string;
  name: string;
  dispensed: string | number;
  received: string | number;
  adjusted: string | number;
};

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const startDate = (searchParams.get("startDate") || "").trim();
    const endDate = (searchParams.get("endDate") || "").trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }

    const summaryRows = await sql`
      SELECT
        item_id AS "itemId",
        MAX(name) AS name,
        SUM(CASE WHEN action = 'เบิกไปหน้างาน' THEN quantity ELSE 0 END) AS dispensed,
        SUM(CASE WHEN action = 'รับเข้าสต๊อกหลัก' THEN quantity ELSE 0 END) AS received,
        SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) AS adjusted
      FROM logs
      WHERE timestamp >= ${startDate}::date
        AND timestamp < (${endDate}::date + INTERVAL '1 day')
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

    const [dailyRows, weeklyStats, slowMoving, insightData] = await Promise.all([
      sql`
        SELECT
          TO_CHAR(timestamp, 'YYYY-MM-DD') AS date,
          item_id AS "itemId",
          SUM(quantity) AS qty
        FROM logs
        WHERE action = 'เบิกไปหน้างาน'
          AND timestamp >= ${startDate}::date
          AND timestamp < (${endDate}::date + INTERVAL '1 day')
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
          AND timestamp < (${endDate}::date + INTERVAL '1 day')
        GROUP BY week
        ORDER BY week ASC
      `,
      sql`
        SELECT m.item_id AS "itemId", m.name, SUM(i.quantity) AS stock
        FROM master_data m
        JOIN inventory i ON m.item_id = i.item_id
        WHERE m.item_id NOT IN (
          SELECT DISTINCT item_id FROM logs
          WHERE action = 'เบิกไปหน้างาน'
            AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
        )
        GROUP BY m.item_id, m.name
        HAVING SUM(i.quantity) > 0
        ORDER BY stock DESC
        LIMIT 5
      `,
      getReagentUsageInsights()
    ]);

    const dailyStats: Record<string, { date: string; totalDispensed: number; items: Record<string, number> }> = {};
    for (const row of dailyRows as Array<{ date: string; itemId: string; qty: string | number }>) {
      if (!dailyStats[row.date]) dailyStats[row.date] = { date: row.date, totalDispensed: 0, items: {} };
      const qty = Number(row.qty) || 0;
      dailyStats[row.date].totalDispensed += qty;
      dailyStats[row.date].items[row.itemId] = (dailyStats[row.date].items[row.itemId] || 0) + qty;
    }

    return NextResponse.json({
      summary,
      dailyStats: Object.values(dailyStats),
      weeklyStats,
      slowMoving,
      insights: insightData.insights,
      expiryRisks: insightData.expiryRisks
    });
  } catch (error: unknown) {
    console.error("Usage API Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
