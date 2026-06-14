"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function VendorOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.user?.role === 'Vendor') {
          fetchOrders(data.user.vendor);
        } else {
          setLoading(false);
        }
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const fetchOrders = async (vendor: string) => {
    try {
      const res = await fetch(`/api/purchase-orders?vendor=${vendor}`);
      if (res.ok) {
        setOrders(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updatePOStatus = async (id: string, status: string, note: string = '') => {
    if (!confirm(`ต้องการเปลี่ยนสถานะใบสั่งซื้อเป็น ${status} หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, vendor_note: note })
      });
      if (res.ok) {
        alert("อัพเดทสำเร็จ");
        fetchOrders(user.vendor);
      } else {
        alert("อัพเดทไม่สำเร็จ");
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user || user.role !== 'Vendor') return <div className="p-6">Unauthorized</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">รับใบสั่งซื้อ (Purchase Orders)</h1>

      <div className="space-y-6">
        {orders.length === 0 && (
          <div className="bg-white p-8 text-center text-gray-500 rounded-lg shadow-sm">
            ไม่มีใบสั่งซื้อใหม่
          </div>
        )}

        {orders.map(po => (
          <div key={po.id} className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-indigo-600 mb-1">{po.po_number}</h2>
                <p className="text-sm text-gray-500">วันที่สร้าง: {new Date(po.created_at).toLocaleString()}</p>
                <p className="text-sm text-gray-500">กำหนดส่ง: {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '-'}</p>
              </div>
              <div className="text-right">
                <span className={`px-3 py-1 rounded-full text-sm font-bold inline-block mb-3 ${
                  po.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-800' :
                  po.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-800' :
                  po.status === 'SHIPPED' ? 'bg-purple-100 text-purple-800' :
                  po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {po.status}
                </span>
                {po.status === 'SUBMITTED' && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => updatePOStatus(po.id, 'CONFIRMED')}
                      className="px-4 py-2 bg-green-600 text-white text-sm rounded shadow hover:bg-green-700"
                    >
                      ✅ ยืนยันรับออเดอร์
                    </button>
                    <button 
                      onClick={() => {
                        const note = prompt("เหตุผลที่ปฏิเสธ:");
                        if (note !== null) updatePOStatus(po.id, 'REJECTED', note);
                      }}
                      className="px-4 py-2 bg-red-100 text-red-700 text-sm rounded hover:bg-red-200"
                    >
                      ❌ ปฏิเสธ
                    </button>
                  </div>
                )}
                {po.status === 'CONFIRMED' && (
                  <button 
                    onClick={() => router.push('/vendor/shipments')}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded shadow hover:bg-blue-700"
                  >
                    📦 สร้างใบส่งของ
                  </button>
                )}
              </div>
            </div>

            {po.note && (
              <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 mb-4 border">
                <strong>หมายเหตุจาก Lab:</strong> {po.note}
              </div>
            )}

            <table className="min-w-full text-sm border-t border-gray-200 mt-4">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">รหัส</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">ชื่อน้ำยา</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">จำนวนที่สั่ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {po.items?.map((item: any) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2">{item.item_id}</td>
                    <td className="px-4 py-2 font-medium">{item.item_name}</td>
                    <td className="px-4 py-2 text-right">{item.quantity} {item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
