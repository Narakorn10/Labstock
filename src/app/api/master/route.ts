import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser, isAdmin } from '@/lib/auth-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isPowerUser = user.role === 'Admin' || user.role === 'Manager';
    if (!isPowerUser) {
      return NextResponse.json({ error: 'Permission denied: Admin or Manager only' }, { status: 403 });
    }

    const data = await request.json();
    const newItemId = data.itemId?.toString().trim();

    // Check for existing ID (Case-insensitive)
    const existing = await sql`
      SELECT item_id, vendor FROM master_data 
      WHERE LOWER(item_id) = LOWER(${newItemId})
    `;
    const exists = existing.length > 0;

    if (data.action === 'update') {
      if (!exists) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ต้องการแก้ไข' }, { status: 404 });

      // Vendor security for updates
      if (isVendor && existing[0].vendor !== user.company) {
        return NextResponse.json({ error: 'Permission denied for this item' }, { status: 403 });
      }

      await sql`
        UPDATE master_data 
        SET 
          barcode = ${data.qrCode},
          name = ${data.name},
          reagent_type = ${data.reagentType},
          job_type = ${data.jobType},
          machine_type = ${data.machineType},
          unit = ${data.unit},
          min_threshold = ${parseInt(data.minThreshold) || 0},
          weekly_target = ${parseInt(data.weeklyTarget) || 0},
          vendor = ${data.vendor || ''}
        WHERE LOWER(item_id) = LOWER(${newItemId})
      `;

      return NextResponse.json({ success: true, message: 'อัปเดตข้อมูลสำเร็จ' });
    } else if (data.action === 'bulk_add') {
      // NEW: Batch Import Support
      const { items } = data;
      let added = 0;
      for (const item of items) {
        // Enforce vendor check for each item in bulk if vendor role
        if (isVendor && item.vendor !== user.company) continue;

        await sql`
          INSERT INTO master_data (item_id, barcode, name, reagent_type, job_type, machine_type, unit, min_threshold, weekly_target, vendor)
          VALUES (${item.itemId}, ${item.barcode}, ${item.name}, ${item.reagentType}, ${item.jobType}, ${item.machineType}, ${item.unit}, ${item.minThreshold || 0}, ${item.weeklyTarget || 0}, ${item.vendor})
          ON CONFLICT (item_id) DO UPDATE SET
            barcode = EXCLUDED.barcode,
            name = EXCLUDED.name,
            vendor = EXCLUDED.vendor
        `;
        added++;
      }
      return NextResponse.json({ success: true, message: `นำเข้าข้อมูลสำเร็จ ${added} รายการ` });
    } else {
      // Add single
      if (exists) return NextResponse.json({ success: false, message: 'ID นี้มีอยู่แล้วในระบบ' }, { status: 400 });

      await sql`
        INSERT INTO master_data (
          item_id, barcode, name, reagent_type, job_type, machine_type, 
          unit, min_threshold, weekly_target, vendor
        ) VALUES (
          ${newItemId}, ${data.qrCode}, ${data.name}, ${data.reagentType}, 
          ${data.jobType}, ${data.machineType}, ${data.unit}, 
          ${parseInt(data.minThreshold) || 0}, ${parseInt(data.weeklyTarget) || 0}, 
          ${data.vendor || ''}
        )
      `;

      return NextResponse.json({ success: true, message: 'ขึ้นทะเบียนรายการใหม่สำเร็จ' });
    }
  } catch (error: any) {
    console.error('Master API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

