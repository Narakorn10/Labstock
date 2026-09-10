import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { getRequestId, logApiEvent, withRequestId } from '@/lib/request-observability';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      logApiEvent('dashboard.unauthorized', { requestId });
      return withRequestId(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId);
    }

    interface DashboardLot {
      inventoryId: number;
      lotNo: string;
      expDate: string;
      receivedOn: string;
      qty: number;
    }

    interface DashboardItem {
      itemId: string;
      qrCode: string;
      name: string;
      reagentType: string;
      jobType: string;
      machineType: string;
      unit: string;
      minThreshold: number;
      weeklyTarget: number;
      vendor: string;
      quantity?: number;
      lots?: DashboardLot[];
    }

    if (user.role === 'Vendor' && !user.vendor) {
      return withRequestId(
        NextResponse.json({ error: 'Vendor profile is not configured' }, { status: 403 }),
        requestId,
      );
    }

    const rows = user.role === 'Vendor'
      ? await sql`
          SELECT
            m.item_id AS "itemId",
            m.barcode AS "qrCode",
            m.name,
            m.reagent_type AS "reagentType",
            m.job_type AS "jobType",
            m.machine_type AS "machineType",
            m.unit,
            m.min_threshold AS "minThreshold",
            m.weekly_target AS "weeklyTarget",
            m.vendor,
            m.is_active AS "isActive",
            m.status_reason AS "statusReason",
            m.status_changed_at AS "statusChangedAt",
            COALESCE(SUM(i.quantity), 0) AS quantity,
            COALESCE(
              json_agg(
                json_build_object(
                  'inventoryId', i.id,
                  'lotNo', i.lot_no,
                  'expDate', TO_CHAR(i.exp_date, 'YYYY-MM-DD'),
                  'receivedOn', TO_CHAR(i.received_on, 'YYYY-MM-DD'),
                  'qty', i.quantity
                )
                ORDER BY i.exp_date ASC NULLS LAST, i.received_on ASC, i.id ASC
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'::json
            ) AS lots
          FROM master_data m
          LEFT JOIN inventory i ON i.item_id = m.item_id AND i.quantity > 0
          WHERE m.vendor = ${user.vendor}
          GROUP BY m.item_id
          ORDER BY m.item_id ASC
        `
      : await sql`
          SELECT
            m.item_id AS "itemId",
            m.barcode AS "qrCode",
            m.name,
            m.reagent_type AS "reagentType",
            m.job_type AS "jobType",
            m.machine_type AS "machineType",
            m.unit,
            m.min_threshold AS "minThreshold",
            m.weekly_target AS "weeklyTarget",
            m.vendor,
            m.is_active AS "isActive",
            m.status_reason AS "statusReason",
            m.status_changed_at AS "statusChangedAt",
            COALESCE(SUM(i.quantity), 0) AS quantity,
            COALESCE(
              json_agg(
                json_build_object(
                  'inventoryId', i.id,
                  'lotNo', i.lot_no,
                  'expDate', TO_CHAR(i.exp_date, 'YYYY-MM-DD'),
                  'receivedOn', TO_CHAR(i.received_on, 'YYYY-MM-DD'),
                  'qty', i.quantity
                )
                ORDER BY i.exp_date ASC NULLS LAST, i.received_on ASC, i.id ASC
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'::json
            ) AS lots
          FROM master_data m
          LEFT JOIN inventory i ON i.item_id = m.item_id AND i.quantity > 0
          GROUP BY m.item_id
          ORDER BY m.item_id ASC
        `;

    const data = (rows as Array<Record<string, unknown>>).map((row) => ({
      ...(row as unknown as DashboardItem),
      quantity: Number(row.quantity ?? 0),
      lots: Array.isArray(row.lots)
        ? (row.lots as Array<Record<string, unknown>>).map((lot) => ({
            inventoryId: Number(lot.inventoryId),
            lotNo: String(lot.lotNo ?? ''),
            expDate: String(lot.expDate ?? ''),
            receivedOn: String(lot.receivedOn ?? ''),
            qty: Number(lot.qty ?? 0),
          }))
        : [],
    }));

    logApiEvent('dashboard.loaded', {
      requestId,
      username: user.username,
      role: user.role,
      rowCount: data.length,
    });
    return withRequestId(NextResponse.json(data), requestId);
  } catch (error: unknown) {
    console.error(`[Dashboard API] requestId=${requestId}`, error);
    return withRequestId(
      NextResponse.json({ error: 'Failed to fetch dashboard data', requestId }, { status: 500 }),
      requestId,
    );
  }
}
