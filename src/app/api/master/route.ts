import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

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

function validateMasterItem(item: MasterItem) {
  const missingFields = [
    !item.itemId && 'Item ID',
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

async function ensureCategories(item: Pick<MasterItem, 'reagentType' | 'jobType' | 'machineType'>) {
  await Promise.all([
    sql`INSERT INTO reagent_types (name) VALUES (${item.reagentType}) ON CONFLICT (name) DO NOTHING`,
    sql`INSERT INTO job_types (name) VALUES (${item.jobType}) ON CONFLICT (name) DO NOTHING`,
    sql`INSERT INTO machine_types (name) VALUES (${item.machineType}) ON CONFLICT (name) DO NOTHING`,
  ]);
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
    const isPowerUser = user.role === 'Admin' || user.role === 'Manager' || isVendor;
    if (!isPowerUser) {
      return NextResponse.json({ error: 'Permission denied: Admin, Manager or Vendor only' }, { status: 403 });
    }

    const data = await request.json() as MasterPayload;

    if (data.action === 'bulk_add') {
      if (!Array.isArray(data.items)) {
        return NextResponse.json({ success: false, message: 'Invalid import data' }, { status: 400 });
      }

      let added = 0;
      for (const [index, rawItem] of data.items.entries()) {
        const item = normalizeMasterItem(rawItem as MasterPayload);
        const validationError = validateMasterItem(item);
        if (validationError) {
          return NextResponse.json(
            { success: false, message: `CSV row ${index + 2}: ${validationError}` },
            { status: 400 }
          );
        }

        if (isVendor && item.vendor !== user.vendor) continue;

        await ensureCategories(item);
        await sql`
          INSERT INTO master_data (item_id, barcode, name, reagent_type, job_type, machine_type, unit, min_threshold, weekly_target, vendor)
          VALUES (${item.itemId}, ${item.qrCode}, ${item.name}, ${item.reagentType}, ${item.jobType}, ${item.machineType}, ${item.unit}, ${item.minThreshold}, ${item.weeklyTarget}, ${item.vendor})
          ON CONFLICT (item_id) DO UPDATE SET
            barcode = EXCLUDED.barcode,
            name = EXCLUDED.name,
            reagent_type = EXCLUDED.reagent_type,
            job_type = EXCLUDED.job_type,
            machine_type = EXCLUDED.machine_type,
            unit = EXCLUDED.unit,
            min_threshold = EXCLUDED.min_threshold,
            weekly_target = EXCLUDED.weekly_target,
            vendor = EXCLUDED.vendor
        `;
        added++;
      }

      return NextResponse.json({ success: true, message: `นำเข้าข้อมูลสำเร็จ ${added} รายการ` });
    }

    const item = normalizeMasterItem(data);
    const validationError = validateMasterItem(item);
    if (validationError) {
      return NextResponse.json({ success: false, message: validationError }, { status: 400 });
    }

    const existing = await sql`
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

      await ensureCategories(item);
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
        WHERE LOWER(item_id) = LOWER(${item.itemId})
      `;

      return NextResponse.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
    }

    if (exists) {
      return NextResponse.json({ success: false, message: 'ID นี้มีอยู่แล้วในระบบ' }, { status: 400 });
    }

    await ensureCategories(item);
    await sql`
      INSERT INTO master_data (
        item_id, barcode, name, reagent_type, job_type, machine_type,
        unit, min_threshold, weekly_target, vendor
      ) VALUES (
        ${item.itemId}, ${item.qrCode}, ${item.name}, ${item.reagentType},
        ${item.jobType}, ${item.machineType}, ${item.unit},
        ${item.minThreshold}, ${item.weeklyTarget}, ${item.vendor}
      )
    `;

    return NextResponse.json({ success: true, message: 'ขึ้นทะเบียนรายการใหม่สำเร็จ' });
  } catch (error: unknown) {
    console.error('Master API Error:', error);
    const message = getDatabaseErrorMessage(error);
    const status = message.startsWith('Invalid category value') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
