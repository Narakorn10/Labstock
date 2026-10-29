import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { loadRuntimeBarcodePatterns } from "@/lib/barcode-runtime";
import { isDepartmentScopeFailure, toApiError } from "@/lib/api-response";
import { authenticateMobileLookup } from "@/lib/mobile-lookup-auth";
import { getRequestId } from "@/lib/request-observability";
import { andDept, getDepartmentScope } from "@/lib/scoped-db";

const LOAD_ERROR_MESSAGE = "Unable to load stock data.";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const auth = await authenticateMobileLookup(request);
    if (!auth.ok) return auth.response;

    const scope = await getDepartmentScope(auth.user);
    // Mode "all" would add no department filter and expose every department; this route never serves that.
    if (scope.mode === "all") throw new Error("Mobile lookup refuses department scope all");

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
          vendor,
          is_active as "isActive"
        FROM master_data m
        WHERE is_active = TRUE${andDept(scope, "m")}
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
        FROM inventory i
        WHERE quantity > 0${andDept(scope, "i")}
        ORDER BY exp_date ASC NULLS LAST, received_on ASC, id ASC
      `,
      // Still unscoped on purpose: every department's patterns, as before (accepted behavior, docs/departments-rollout.md).
      loadRuntimeBarcodePatterns({ mode: "all" }),
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

    return NextResponse.json(
      {
        reagents,
        patterns: runtimePatterns.patterns,
        v2Patterns: runtimePatterns.v2Patterns,
        engineVersion: runtimePatterns.engineVersion,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (isDepartmentScopeFailure(error)) return toApiError(error, requestId).response;
    // Fixed body on purpose: error messages can contain the username or SQL text.
    console.error("Mobile lookup error:", error);
    return NextResponse.json({ error: LOAD_ERROR_MESSAGE }, { status: 500 });
  }
}
