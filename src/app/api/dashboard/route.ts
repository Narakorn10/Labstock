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
    interface DashboardLot {
      lotNo: string;
      expDate: string;
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

    const inventoryMap: Record<string, { totalQty: number, lots: DashboardLot[] }> = {};
    inventoryData.forEach(inv => {
      const id = inv.item_id as string;
      if (!inventoryMap[id]) {
        inventoryMap[id] = { totalQty: 0, lots: [] };
      }
      inventoryMap[id].totalQty += parseFloat(inv.qty as string);
      inventoryMap[id].lots.push({
        lotNo: inv.lotNo as string,
        expDate: inv.expDate as string,
        qty: parseFloat(inv.qty as string)
      });
    });

    let data: DashboardItem[] = (masterData as unknown as DashboardItem[]).map(item => {
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
  } catch (error: unknown) {
    console.error('Dashboard API Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
