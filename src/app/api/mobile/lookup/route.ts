import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { loadRuntimeBarcodePatterns } from "@/lib/barcode-runtime";

export async function GET() {
  try {
    const formatInventoryDate = (value: unknown) => {
      if (!value) return "";
      if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
      }

      const text = String(value);
      const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
      if (directMatch) {
        return directMatch[1];
      }

      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) {
        return text;
      }

      return parsed.toISOString().slice(0, 10);
    };

    const [masterData, inventoryData, runtimePatterns] = await Promise.all([
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
          id as "inventoryId",
          item_id,
          lot_no as "lotNo",
          TO_CHAR(exp_date, 'YYYY-MM-DD') as "expDate",
          TO_CHAR(received_on, 'YYYY-MM-DD') as "receivedOn",
          quantity as qty
        FROM inventory
        WHERE quantity > 0
        ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC
      `,
      loadRuntimeBarcodePatterns(),
    ]);

    interface LookupLot {
      inventoryId: number;
      lotNo: string;
      expDate: string;
      receivedOn: string;
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
        inventoryId: Number(inv.inventoryId),
        lotNo: inv.lotNo as string,
        expDate: formatInventoryDate(inv.expDate),
        receivedOn: formatInventoryDate(inv.receivedOn),
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

    return NextResponse.json({
      reagents,
      patterns: runtimePatterns.patterns,
      v2Patterns: runtimePatterns.v2Patterns,
      engineVersion: runtimePatterns.engineVersion,
    });
  } catch (error: unknown) {
    console.error("Mobile lookup error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
