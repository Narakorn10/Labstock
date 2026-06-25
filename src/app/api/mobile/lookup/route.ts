import { NextResponse } from "next/server";
import sql from "@/lib/db";

export async function GET() {
  try {
    const [masterData, inventoryData, patterns] = await Promise.all([
      sql`
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
      `,
      sql`
        SELECT
          item_id,
          lot_no as "lotNo",
          exp_date as "expDate",
          quantity as qty
        FROM inventory
        WHERE quantity > 0
        ORDER BY exp_date ASC
      `,
      sql`
        SELECT id, name, regex_pattern, item_id_group, lot_no_group, exp_date_group
        FROM barcode_patterns
        ORDER BY created_at DESC
      `,
    ]);

    interface LookupLot {
      lotNo: string;
      expDate: string;
      qty: number;
    }

    interface LookupItem {
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
      lots?: LookupLot[];
    }

    const inventoryMap: Record<string, { totalQty: number; lots: LookupLot[] }> = {};
    inventoryData.forEach((inv) => {
      const id = inv.item_id as string;
      if (!inventoryMap[id]) {
        inventoryMap[id] = { totalQty: 0, lots: [] };
      }
      inventoryMap[id].totalQty += parseFloat(inv.qty as string);
      inventoryMap[id].lots.push({
        lotNo: inv.lotNo as string,
        expDate: inv.expDate as string,
        qty: parseFloat(inv.qty as string),
      });
    });

    const reagents = (masterData as unknown as LookupItem[]).map((item) => {
      const inv = inventoryMap[item.itemId] || { totalQty: 0, lots: [] };
      return {
        ...item,
        quantity: inv.totalQty,
        lots: inv.lots,
      };
    });

    return NextResponse.json({ reagents, patterns });
  } catch (error: unknown) {
    console.error("Mobile lookup error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
