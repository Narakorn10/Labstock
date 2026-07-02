import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function GET(request: Request) {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[Usage API] ${msg}`);
    logs.push(msg);
  };

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawStartDate = searchParams.get('startDate') || '';
    const rawEndDate = searchParams.get('endDate') || '';

    // Strict Regex for YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    const startDate = rawStartDate.trim();
    const endDate = rawEndDate.trim();

    log(`Params: startDate="${startDate}", endDate="${endDate}", user=${user.username}`);

    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      log(`ERROR: Invalid date format. Received: start="${startDate}", end="${endDate}"`);
      return NextResponse.json({ 
        error: 'Invalid date format. Use YYYY-MM-DD', 
        received: { startDate, endDate },
        logs 
      }, { status: 400 });
    }

    // 1. Fetch Summary Data
    log('Step 1: Summary query...');
    let summaryRows;
    try {
      // Use explicit cast and ensured valid strings
      summaryRows = await sql`
        SELECT 
          item_id as "itemId", 
          MAX(name) as name,
          SUM(CASE WHEN action = 'เบิกไปหน้างาน' THEN quantity ELSE 0 END) as dispensed,
          SUM(CASE WHEN action = 'รับเข้าสต๊อกหลัก' THEN quantity ELSE 0 END) as received,
          SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) as adjusted
        FROM logs
        WHERE timestamp >= ${startDate}::date AND timestamp <= (${endDate}::date + interval '1 day')
        GROUP BY item_id
      `;
      log(`Summary success: ${summaryRows.length} rows`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      log(`Summary FAILED: ${message}`);
      throw e;
    }

    // 2. Fetch Detailed Stats
    if (user.role === 'Admin' || user.role === 'Manager') {
      log('Step 2: Detailed queries...');

      let dailyRows, weeklyStats, expiringSoon, slowMoving;

      try {
        log('Sub-step: dailyRows...');
        dailyRows = await sql`
          SELECT 
            TO_CHAR(timestamp, 'YYYY-MM-DD') as date,
            item_id as "itemId",
            SUM(quantity) as "qty"
          FROM logs
          WHERE action = 'เบิกไปหน้างาน' 
            AND timestamp >= ${startDate}::date AND timestamp <= (${endDate}::date + interval '1 day')
          GROUP BY date, item_id
          ORDER BY date ASC
        `;
        log(`dailyRows success: ${dailyRows.length} rows`);

        log('Sub-step: weeklyStats...');
        weeklyStats = await sql`
          SELECT 
            TO_CHAR(DATE_TRUNC('week', timestamp), 'YYYY-"W"IW') as week,
            SUM(quantity) as "totalDispensed"
          FROM logs
          WHERE action = 'เบิกไปหน้างาน'
            AND timestamp >= ${startDate}::date AND timestamp <= (${endDate}::date + interval '1 day')
          GROUP BY week
          ORDER BY week ASC
        `;

        log(`weeklyStats success: ${weeklyStats.length} rows`);

        log('Sub-step: expiringSoon...');
        expiringSoon = await sql`
          SELECT i.item_id as "itemId", m.name, i.lot_no as "lotNo", i.exp_date as "expDate", i.quantity
          FROM inventory i
          JOIN master_data m ON i.item_id = m.item_id
          WHERE i.quantity > 0 
            AND i.exp_date IS NOT NULL 
          ORDER BY i.exp_date ASC
          LIMIT 5
        `;
        log(`expiringSoon success: ${expiringSoon.length} rows`);

        log('Sub-step: slowMoving...');
        slowMoving = await sql`
          SELECT m.item_id as "itemId", m.name, SUM(i.quantity) as stock
          FROM master_data m
          JOIN inventory i ON m.item_id = i.item_id
          WHERE m.item_id NOT IN (
            SELECT DISTINCT item_id FROM logs 
            WHERE action = 'เบิกไปหน้างาน' AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
          )
          GROUP BY m.item_id, m.name
          HAVING SUM(i.quantity) > 0
          ORDER BY stock DESC
          LIMIT 5
        `;
        log(`slowMoving success: ${slowMoving.length} rows`);

      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        log(`Detailed queries FAILED: ${message}`);
        throw e;
      }
      interface DailyStatInternal {
        date: string;
        totalDispensed: number;
        items: Record<string, number>;
      }

      const dailyStats: Record<string, DailyStatInternal> = {};
      dailyRows.forEach(r => {
        const date = r.date as string;
        if (!dailyStats[date]) {
          dailyStats[date] = { date, totalDispensed: 0, items: {} };
        }
        const qty = parseFloat(r.qty as string) || 0;
        dailyStats[date].totalDispensed += qty;
        const itemId = r.itemId as string;
        dailyStats[date].items[itemId] = (dailyStats[date].items[itemId] || 0) + qty;
      });

      interface SummaryItem {
        itemId: string;
        name: string;
        dispensed: string | number;
        received: string | number;
        adjusted: string | number;
      }

      return NextResponse.json({
        summary: (summaryRows as unknown as SummaryItem[]).map((r) => ({
          ...r,
          dispensed: parseFloat(r.dispensed as string) || 0,
          received: parseFloat(r.received as string) || 0,
          adjusted: parseFloat(r.adjusted as string) || 0
        })),
        dailyStats: Object.values(dailyStats),
        weeklyStats,
        expiringSoon,
        slowMoving
      });
    }

    interface SummaryItemShort {
      itemId: string;
      name: string;
      dispensed: string | number;
      received: string | number;
      adjusted: string | number;
    }
    return NextResponse.json({
      summary: (summaryRows as unknown as SummaryItemShort[]).map(r => ({
        ...r,
        dispensed: parseFloat(r.dispensed as string) || 0,
        received: parseFloat(r.received as string) || 0,
        adjusted: parseFloat(r.adjusted as string) || 0
      }))
    });
  } catch (error: unknown) {
    console.error('Usage API Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : null;
    return NextResponse.json({ 
      error: message,
      stack: stack,
      details: error
    }, { status: 500 });
  }
}
