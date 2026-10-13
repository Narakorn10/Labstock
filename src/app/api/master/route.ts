import { NextResponse } from 'next/server';
import type { NeonQueryPromise } from '@neondatabase/serverless';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';
import { andDeptWrite, deptInsert, departmentErrorResponse, getDepartmentScope, writeDepartmentId, type DepartmentScope } from '@/lib/scoped-db';
import { canManageRoomReagents } from '@/lib/room-admin';

type MasterPayload = {
  action?: string;
  itemId?: unknown;
  qrCode?: unknown;
  barcode?: unknown;
  name?: unknown;
  reagentType?: unknown;
  jobType?: unknown;
  machineType?: unknown;
  unit?: unknown;
  minThreshold?: unknown;
  weeklyTarget?: unknown;
  vendor?: unknown;
  items?: unknown;
};

type MasterItem = {
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
};

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMasterItem(payload: MasterPayload): MasterItem {
  return {
    itemId: toText(payload.itemId).toUpperCase(),
    qrCode: toText(payload.qrCode ?? payload.barcode),
    name: toText(payload.name),
    reagentType: toText(payload.reagentType),
    jobType: toText(payload.jobType),
    machineType: toText(payload.machineType),
    unit: toText(payload.unit),
    minThreshold: toNumber(payload.minThreshold),
    weeklyTarget: toNumber(payload.weeklyTarget),
    vendor: toText(payload.vendor),
  };
}

function validateMasterItem(item: MasterItem, requireItemId = false) {
  const missingFields = [
    requireItemId && !item.itemId && 'Item ID',
    !item.name && 'Name',
    !item.reagentType && 'Reagent Type',
    !item.jobType && 'Job Type',
    !item.machineType && 'Machine Type',
    !item.unit && 'Unit',
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return `Missing required field: ${missingFields.join(', ')}`;
  }

  return null;
}

// item_id is still the global primary key, so an upsert could overwrite a row that belongs to ANOTHER room.
// In a room the DO UPDATE only applies to that room's own row (a foreign row is left untouched and RETURNING is empty).
// Legacy: both fragments are empty and the SQL is exactly the old statement.
function masterInsertQuery(
  item: MasterItem,
  scope: DepartmentScope,
): NeonQueryPromise<false, false> {
  const { column, value } = deptInsert(scope);
  const ownRowOnly = scope.mode === 'one' ? sql` WHERE master_data.department_id = ${scope.departmentId}` : sql``;
  if (item.itemId) {
    return sql`
      INSERT INTO master_data (item_id, barcode, name, reagent_type, job_type, machine_type, unit, min_threshold, weekly_target, vendor${column})
      VALUES (${item.itemId}, ${item.qrCode}, ${item.name}, ${item.reagentType}, ${item.jobType}, ${item.machineType}, ${item.unit}, ${item.minThreshold}, ${item.weeklyTarget}, ${item.vendor}${value})
      ON CONFLICT (item_id) DO UPDATE SET
        barcode = EXCLUDED.barcode,
        name = EXCLUDED.name,
        reagent_type = EXCLUDED.reagent_type,
        job_type = EXCLUDED.job_type,
        machine_type = EXCLUDED.machine_type,
        unit = EXCLUDED.unit,
        min_threshold = EXCLUDED.min_threshold,
        weekly_target = EXCLUDED.weekly_target,
        vendor = EXCLUDED.vendor${ownRowOnly}
      RETURNING item_id
    `;
  }

  return sql`
    INSERT INTO master_data (barcode, name, reagent_type, job_type, machine_type, unit, min_threshold, weekly_target, vendor${column})
    VALUES (${item.qrCode}, ${item.name}, ${item.reagentType}, ${item.jobType}, ${item.machineType}, ${item.unit}, ${item.minThreshold}, ${item.weeklyTarget}, ${item.vendor}${value})
    RETURNING item_id
  `;
}

// The three category tables still have a globally unique name (master_data references them by name), so an existing
// name of another room is kept as is (DO NOTHING) and the item can still use it. New names get the room of the item.
function categoryInsertQueries(item: Pick<MasterItem, 'reagentType' | 'jobType' | 'machineType'>, scope: DepartmentScope) {
  const { column, value } = deptInsert(scope);
  return [
    sql`INSERT INTO reagent_types (name${column}) VALUES (${item.reagentType}${value}) ON CONFLICT (name) DO NOTHING`,
    sql`INSERT INTO job_types (name${column}) VALUES (${item.jobType}${value}) ON CONFLICT (name) DO NOTHING`,
    sql`INSERT INTO machine_types (name${column}) VALUES (${item.machineType}${value}) ON CONFLICT (name) DO NOTHING`,
  ];
}

async function ensureCategories(item: Pick<MasterItem, 'reagentType' | 'jobType' | 'machineType'>, scope: DepartmentScope) {
  await Promise.all(categoryInsertQueries(item, scope));
}

function getDatabaseErrorMessage(error: unknown) {
  const dbError = error as { code?: string; constraint?: string; message?: string };

  if (dbError.code === '23503' || dbError.constraint === 'fk_job_type') {
    return 'Invalid category value. Please check Reagent Type, Job Type, and Machine Type before saving.';
  }

  return dbError.message || String(error);
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isVendor = user.role === 'Vendor';
    const isPowerUser = isVendor || await canManageRoomReagents(user);
    if (!isPowerUser) {
      return NextResponse.json({ error: 'Permission denied: Admin, Manager, room admin or Vendor only' }, { status: 403 });
    }

    const data = await request.json() as MasterPayload;
    const scope = await getDepartmentScope(user);
    writeDepartmentId(scope); // "all rooms" is read-only: refuse before anything is written

    if (data.action === 'bulk_add') {
      if (!Array.isArray(data.items)) {
        return NextResponse.json({ success: false, message: 'Invalid import data' }, { status: 400 });
      }

      const parsedItems: MasterItem[] = [];
      for (const [index, rawItem] of data.items.entries()) {
        const item = normalizeMasterItem(rawItem as MasterPayload);
        const validationError = validateMasterItem(item);
        if (validationError) {
          return NextResponse.json(
            { success: false, message: `CSV row ${index + 2}: ${validationError}` },
            { status: 400 }
          );
        }

        if (isVendor && item.vendor && item.vendor !== user.vendor) continue;
        parsedItems.push(isVendor ? { ...item, vendor: user.vendor || item.vendor } : item);
      }

      if (scope.mode === 'one') {
        // item_id is globally unique: an ID that already belongs to another room would be skipped silently. Refuse the
        // whole import (nothing written) and name the IDs, so the user can fix the file.
        const ids = parsedItems.map((item) => item.itemId).filter(Boolean);
        const foreign = ids.length === 0 ? [] : await sql`
          SELECT item_id FROM master_data
          WHERE item_id = ANY(${ids}::text[]) AND department_id <> ${scope.departmentId}
        `;
        if (foreign.length > 0) {
          const list = foreign.map((row) => String(row.item_id)).join(', ');
          return NextResponse.json(
            { success: false, message: `ID ต่อไปนี้มีอยู่แล้วในระบบ (ห้องอื่นใช้อยู่) จึงไม่นำเข้า: ${list}` },
            { status: 400 },
          );
        }
      }

      const transactionResults = await sql.transaction(parsedItems.flatMap((item) => [
        ...categoryInsertQueries(item, scope),
        masterInsertQuery(item, scope),
      ]));
      const generatedItemIds = transactionResults
        .filter((_, index) => (index + 1) % 4 === 0)
        .flatMap((rows, index) => parsedItems[index]?.itemId
          ? []
          : (rows as Array<{ item_id?: unknown }>).map((row) => String(row.item_id || '')).filter(Boolean));

      return NextResponse.json({
        success: true,
        message: `นำเข้าข้อมูลสำเร็จ ${parsedItems.length} รายการ`,
        generatedItemIds,
      });
    }

    const item = normalizeMasterItem(data);
    const validationError = validateMasterItem(item, data.action === 'update');
    if (validationError) {
      return NextResponse.json({ success: false, message: validationError }, { status: 400 });
    }

    // update: only the user's own room (another room's row is "not found"); create: any room (item_id is globally unique)
    const existing = data.action === 'update'
      ? await sql`
          SELECT item_id, vendor FROM master_data
          WHERE LOWER(item_id) = LOWER(${item.itemId})${andDeptWrite(scope)}
        `
      : await sql`
          SELECT item_id, vendor FROM master_data
          WHERE LOWER(item_id) = LOWER(${item.itemId})
        `;
    const exists = existing.length > 0;

    if (data.action === 'update') {
      if (!exists) {
        return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ต้องการแก้ไข' }, { status: 404 });
      }

      if (isVendor && existing[0].vendor !== user.vendor) {
        return NextResponse.json({ error: 'Permission denied for this item' }, { status: 403 });
      }

      await ensureCategories(item, scope);
      await sql`
        UPDATE master_data
        SET
          barcode = ${item.qrCode},
          name = ${item.name},
          reagent_type = ${item.reagentType},
          job_type = ${item.jobType},
          machine_type = ${item.machineType},
          unit = ${item.unit},
          min_threshold = ${item.minThreshold},
          weekly_target = ${item.weeklyTarget},
          vendor = ${item.vendor}
        WHERE LOWER(item_id) = LOWER(${item.itemId})${andDeptWrite(scope)}
      `;

      return NextResponse.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
    }

    if (exists) {
      return NextResponse.json({ success: false, message: 'ID นี้มีอยู่แล้วในระบบ' }, { status: 400 });
    }

    await ensureCategories(item, scope);
    const [created] = await sql.transaction([masterInsertQuery(item, scope)]);
    if ((created as unknown[]).length === 0) {
      return NextResponse.json({ success: false, message: 'ID นี้มีอยู่แล้วในระบบ' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'ขึ้นทะเบียนรายการใหม่สำเร็จ',
      itemId: (created as Array<{ item_id: string }>)[0]?.item_id || item.itemId,
    });
  } catch (error: unknown) {
    const scoped = departmentErrorResponse(error);
    if (scoped) return scoped;
    console.error('Master API Error:', error);
    const message = getDatabaseErrorMessage(error);
    const status = message.startsWith('Invalid category value') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
