import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Fetch all master data
    const masterData = await sql`
      SELECT 
        item_id as "itemId",
        barcode as "qrCode",
        name,
        reagent_type as "reagentType",
        job_type as "jobType",
        machine_type as "machineType",
        unit,
        min_threshold as "minThreshold",
        weekly_target as "weeklyTarget",
        vendor
      FROM master_data
      ORDER BY item_id ASC
    `;

    // Fetch all inventory where quantity > 0
    const inventoryData = await sql`
      SELECT 
        item_id,
        lot_no as "lotNo",
        exp_date as "expDate",
        quantity as qty
      FROM inventory
      WHERE quantity > 0
      ORDER BY exp_date ASC -- FEFO order
    `;

    // Map inventory to master data
    const inventoryMap: Record<string, { totalQty: number, lots: any[] }> = {};
    inventoryData.forEach(inv => {
      const id = inv.item_id;
      if (!inventoryMap[id]) {
        inventoryMap[id] = { totalQty: 0, lots: [] };
      }
      inventoryMap[id].totalQty += parseFloat(inv.qty);
      inventoryMap[id].lots.push({
        lotNo: inv.lotNo,
        expDate: inv.expDate,
        qty: parseFloat(inv.qty)
      });
    });

    let data = masterData.map(item => {
      const inv = inventoryMap[item.itemId] || { totalQty: 0, lots: [] };
      return {
        ...item,
        quantity: inv.totalQty,
        lots: inv.lots
      };
    });

    // Filter for Vendor role
    if (user?.role === 'Vendor' && user.company) {
      data = data.filter(item => item.vendor === user.company);
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Dashboard API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
