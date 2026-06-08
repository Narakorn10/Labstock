import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 });
    }

    // 1. Fetch Summary Data (Grouped by Item)
    const summaryPromise = sql`
      SELECT 
        item_id as "itemId", 
        MAX(name) as name,
        SUM(CASE WHEN action = 'เบิกไปหน้างาน' THEN quantity ELSE 0 END) as dispensed,
        SUM(CASE WHEN action = 'รับเข้าสต๊อกหลัก' THEN quantity ELSE 0 END) as received,
        SUM(CASE WHEN action LIKE '%ปรับปรุงยอด%' THEN quantity ELSE 0 END) as adjusted
      FROM logs
      WHERE timestamp >= ${startDate} AND timestamp <= ${endDate + ' 23:59:59'}
      GROUP BY item_id
    `;

    // 2. Fetch Daily & Weekly Stats for Admin/Manager
    if (user.role === 'Admin' || user.role === 'Manager') {
      const [summaryRows, dailyRows, weeklyStats, expiringSoon, slowMoving] = await Promise.all([
        summaryPromise,
        sql`
          SELECT 
            TO_CHAR(timestamp, 'YYYY-MM-DD') as date,
            item_id as "itemId",
            SUM(quantity) as "qty"
          FROM logs
          WHERE action = 'เบิกไปหน้างาน' 
            AND timestamp >= ${startDate} AND timestamp <= ${endDate + ' 23:59:59'}
          GROUP BY date, item_id
          ORDER BY date ASC
        `,
        sql`
          SELECT 
            TO_CHAR(DATE_TRUNC('week', timestamp), 'YYYY-"W"IW') as week,
            SUM(quantity) as "totalDispensed"
          FROM logs
          WHERE action = 'เบิกไปหน้างาน'
            AND timestamp >= ${startDate} AND timestamp <= ${endDate + ' 23:59:59'}
          GROUP BY week
          ORDER BY week ASC
        `,
        sql`
          SELECT i.item_id as "itemId", m.name, i.lot_no as "lotNo", i.exp_date as "expDate", i.quantity
          FROM inventory i
          JOIN master_data m ON i.item_id = m.item_id
          WHERE i.quantity > 0 
            AND i.exp_date IS NOT NULL 
            AND i.exp_date != ''
          ORDER BY i.exp_date ASC
          LIMIT 5
        `,
        sql`
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
        `
      ]);

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

    const summaryRows = await summaryPromise;
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
