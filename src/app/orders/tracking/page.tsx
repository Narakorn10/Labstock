"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TrackingBoardPage() {
  const router = useRouter();
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('labstock_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchShipments = async () => {
    try {
      // Note: Admin/Manager view fetches all, we should use a specific tracking endpoint
      // but for simplicity we reuse the vendor shipments endpoint which returns all for admins.
      const res = await fetch('/api/vendor/shipments', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        setShipments(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShipments();
  }, []);

  const columns = [
    { id: 'In Transit', title: '🚚 กำลังจัดส่ง (In Transit)' },
    { id: 'Received', title: '✅ รับของแล้ว (Received)' },
    { id: 'Cancelled', title: '❌ ยกเลิก (Cancelled)' }
  ];

  if (loading) return <div className="p-6">Loading tracking board...</div>;

  return (
    <div className="p-6 h-screen flex flex-col bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">📦 Shipment Tracking Board</h1>
        <button onClick={() => router.push('/orders')} className="text-indigo-600">← กลับไปหน้าระบบสั่งซื้อ</button>
      </div>

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4">
        {columns.map(col => {
          const colShipments = shipments.filter(s => s.status === col.id);
          return (
            <div key={col.id} className="w-80 flex-shrink-0 bg-gray-200 rounded-lg p-4 flex flex-col max-h-full">
              <div className="flex justify-between items-center mb-4 px-1">
                <h3 className="font-bold text-gray-700">{col.title}</h3>
                <span className="bg-gray-300 text-gray-700 text-xs py-1 px-2 rounded-full font-bold">
                  {colShipments.length}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {colShipments.map(s => (
                  <div key={s.id} className="bg-white p-4 rounded shadow-sm border-l-4 border-indigo-500 hover:shadow-md transition">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                        {s.reference_no}
                      </span>
                      <span className="text-xs text-gray-500">{new Date(s.created_at).toLocaleDateString()}</span>
                    </div>
                    <h4 className="font-bold text-sm mb-1 line-clamp-1" title={s.reagent_name}>{s.reagent_name}</h4>
                    <p className="text-xs text-gray-600 mb-2">Vendor: {s.vendor}</p>
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-800">{s.quantity} {s.unit}</span>
                      {s.po_number && (
                        <span 
                          onClick={() => router.push(`/orders/${s.po_number}`)}
                          className="text-indigo-600 cursor-pointer hover:underline text-xs"
                        >
                          {s.po_number}
                        </span>
                      )}
                    </div>
                    {s.tracking_no && (
                      <div className="mt-3 pt-3 border-t text-xs">
                        <span className="text-gray-500">{s.tracking_provider}:</span> <span className="font-bold">{s.tracking_no}</span>
                      </div>
                    )}
                  </div>
                ))}
                {colShipments.length === 0 && (
                  <div className="text-center p-4 text-gray-400 text-sm border-2 border-dashed border-gray-300 rounded">
                    ไม่มีรายการ
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
