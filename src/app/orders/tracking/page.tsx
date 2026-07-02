"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ShipmentBoardItem {
  id: number;
  reference_no: string;
  created_at: string;
  reagent_name: string;
  vendor: string;
  quantity: number;
  unit: string;
  status: "In Transit" | "Received" | "Cancelled";
  po_number: string | null;
  tracking_no: string | null;
  tracking_provider: string | null;
}

interface ShipmentColumn {
  id: ShipmentBoardItem["status"];
  title: string;
}

export default function TrackingBoardPage() {
  const router = useRouter();
  const [shipments, setShipments] = useState<ShipmentBoardItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchShipments = useCallback(async () => {
    try {
      // Note: Admin/Manager view fetches all, we should use a specific tracking endpoint
      // but for simplicity we reuse the vendor shipments endpoint which returns all for admins.
      const res = await fetch("/api/vendor/shipments");
      if (res.ok) {
        const data = (await res.json()) as ShipmentBoardItem[];
        setShipments(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadShipments = async () => {
      try {
        const res = await fetch("/api/vendor/shipments");
        if (res.ok) {
          const data = (await res.json()) as ShipmentBoardItem[];
          if (active) {
            setShipments(Array.isArray(data) ? data : []);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadShipments();

    return () => {
      active = false;
    };
  }, [fetchShipments]);

  const columns: ShipmentColumn[] = [
    { id: "In Transit", title: "ðŸšš à¸à¸³à¸¥à¸±à¸‡à¸ˆà¸±à¸”à¸ªà¹ˆà¸‡ (In Transit)" },
    { id: "Received", title: "âœ… à¸£à¸±à¸šà¸‚à¸­à¸‡à¹à¸¥à¹‰à¸§ (Received)" },
    { id: "Cancelled", title: "âŒ à¸¢à¸à¹€à¸¥à¸´à¸ (Cancelled)" },
  ];

  if (loading) return <div className="p-6">Loading tracking board...</div>;

  return (
    <div className="p-6 h-screen flex flex-col bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">ðŸ“¦ Shipment Tracking Board</h1>
        <button onClick={() => router.push("/orders")} className="text-indigo-600">
          â† à¸à¸¥à¸±à¸šà¹„à¸›à¸«à¸™à¹‰à¸²à¸£à¸°à¸šà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­
        </button>
      </div>

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4">
        {columns.map((column) => {
          const columnShipments = shipments.filter((shipment) => shipment.status === column.id);
          return (
            <div key={column.id} className="w-80 flex-shrink-0 bg-gray-200 rounded-lg p-4 flex flex-col max-h-full">
              <div className="flex justify-between items-center mb-4 px-1">
                <h3 className="font-bold text-gray-700">{column.title}</h3>
                <span className="bg-gray-300 text-gray-700 text-xs py-1 px-2 rounded-full font-bold">
                  {columnShipments.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {columnShipments.map((shipment) => (
                  <div
                    key={shipment.id}
                    className="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-500 hover:shadow-md transition"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                        {shipment.reference_no}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(shipment.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="font-bold text-sm mb-1 line-clamp-1" title={shipment.reagent_name}>
                      {shipment.reagent_name}
                    </h4>
                    <p className="text-xs text-gray-600 mb-2">Vendor: {shipment.vendor}</p>
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-800">
                        {shipment.quantity} {shipment.unit}
                      </span>
                      {shipment.po_number && (
                        <span
                          onClick={() => router.push(`/orders/${shipment.po_number}`)}
                          className="text-indigo-600 cursor-pointer hover:underline text-xs"
                        >
                          {shipment.po_number}
                        </span>
                      )}
                    </div>
                    {shipment.tracking_no && (
                      <div className="mt-3 pt-3 border-t text-xs">
                        <span className="text-gray-500">{shipment.tracking_provider}:</span>{" "}
                        <span className="font-bold">{shipment.tracking_no}</span>
                      </div>
                    )}
                  </div>
                ))}
                {columnShipments.length === 0 && (
                  <div className="text-center p-4 text-gray-400 text-sm border-2 border-dashed border-gray-300 rounded">
                    à¹„à¸¡à¹ˆà¸¡à¸µà¸£à¸²à¸¢à¸à¸²à¸£
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
