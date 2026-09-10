import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

function normalizeReason(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'Admin' && user.role !== 'Manager') {
      return NextResponse.json({ error: 'เฉพาะ Admin หรือ Manager เท่านั้นที่เปลี่ยนสถานะน้ำยาได้' }, { status: 403 });
    }

    const { itemId } = await params;
    const normalizedItemId = decodeURIComponent(itemId).trim().toUpperCase();
    if (!normalizedItemId || normalizedItemId.length > 160) {
      return NextResponse.json({ error: 'รหัสน้ำยาไม่ถูกต้อง' }, { status: 400 });
    }

    const body = await request.json() as { isActive?: unknown; reason?: unknown };
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive ต้องเป็น true หรือ false' }, { status: 400 });
    }

    const reason = normalizeReason(body.reason);
    if (!body.isActive && !reason) {
      return NextResponse.json({ error: 'กรุณาระบุเหตุผลก่อนปิดใช้งานน้ำยา' }, { status: 400 });
    }

    const [rows] = await sql.transaction([sql`
      WITH current_item AS (
        SELECT m.*
        FROM master_data m
        WHERE UPPER(m.item_id) = ${normalizedItemId}
        FOR UPDATE
      ),
      impact AS (
        SELECT
          current_item.item_id,
          COUNT(DISTINCT inventory.id) FILTER (WHERE inventory.quantity > 0)::INTEGER AS stock_lot_count,
          COALESCE(SUM(inventory.quantity) FILTER (WHERE inventory.quantity > 0), 0) AS stock_quantity,
          (SELECT COUNT(*)::INTEGER FROM reagent_loans loan
            WHERE loan.item_id = current_item.item_id AND loan.status = 'OPEN') AS open_loan_count,
          (SELECT COUNT(*)::INTEGER FROM purchase_order_items poi
            INNER JOIN purchase_orders po ON po.id = poi.po_id
            WHERE poi.item_id = current_item.item_id
              AND po.status IN ('DRAFT', 'SUBMITTED', 'PENDING_LAB_REVIEW', 'REVISION_REQUESTED', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED')) AS open_order_item_count
        FROM current_item
        LEFT JOIN inventory ON inventory.item_id = current_item.item_id
        GROUP BY current_item.item_id
      ),
      updated_item AS (
        UPDATE master_data m
        SET is_active = ${body.isActive},
            status_reason = ${reason || null},
            status_changed_at = NOW(),
            status_changed_by = ${user.username}
        FROM current_item current
        WHERE m.item_id = current.item_id
        RETURNING m.*
      ),
      history AS (
        INSERT INTO master_data_status_history (item_id, is_active, reason, changed_by)
        SELECT item_id, is_active, ${reason || null}, ${user.username}
        FROM updated_item
        RETURNING id
      )
      SELECT
        updated_item.item_id,
        updated_item.is_active,
        updated_item.status_reason,
        updated_item.status_changed_at,
        updated_item.status_changed_by,
        impact.stock_lot_count,
        impact.stock_quantity,
        impact.open_loan_count,
        impact.open_order_item_count
      FROM updated_item
      INNER JOIN impact ON impact.item_id = updated_item.item_id
    `]);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'ไม่พบรายการน้ำยาที่ต้องการเปลี่ยนสถานะ' }, { status: 404 });
    }

    const row = rows[0] as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      data: {
        itemId: row.item_id,
        isActive: Boolean(row.is_active),
        statusReason: row.status_reason,
        statusChangedAt: row.status_changed_at,
        statusChangedBy: row.status_changed_by,
        impact: {
          stockLotCount: Number(row.stock_lot_count ?? 0),
          stockQuantity: Number(row.stock_quantity ?? 0),
          openLoanCount: Number(row.open_loan_count ?? 0),
          openOrderItemCount: Number(row.open_order_item_count ?? 0),
        },
      },
    });
  } catch (error: unknown) {
    console.error('Master status API error:', error);
    const dbError = error as { code?: string; message?: string };
    if (dbError.code === '42703') {
      return NextResponse.json({ error: 'ยังไม่ได้ติดตั้ง migration upgrade_v24_reagent_lifecycle.sql' }, { status: 503 });
    }
    return NextResponse.json({ error: 'ไม่สามารถเปลี่ยนสถานะน้ำยาได้ในขณะนี้' }, { status: 500 });
  }
}
