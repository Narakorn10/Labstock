"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PODetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [po, setPo] = useState<any>(null);
  const [tracking, setTracking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('labstock_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchTracking = async (trackingNo: string, provider: string) => {
    try {
      const res = await fetch(`/api/tracking/${trackingNo}?provider=${provider || 'THAIPOST'}`);
      if (res.ok) {
        setTracking(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPO = async () => {
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setPo(data);
        
        // If there is a tracking number, let's pretend we have an endpoint that finds it.
        // Actually we added tracking_no to shipments. 
        // We need an API to fetch shipments for a PO, or we just fetch the tracking if we know it.
        // Let's assume we fetch shipments for this PO.
        const shipRes = await fetch(`/api/vendor/shipments`, {
          headers: getAuthHeaders()
        }); // We might need a better endpoint to get shipments by PO.
        if (shipRes.ok) {
          const shipments = await shipRes.json();
          const poShipments = shipments.filter((s: any) => s.po_number === data.po_number);
          if (poShipments.length > 0 && poShipments[0].tracking_no) {
            fetchTracking(poShipments[0].tracking_no, poShipments[0].tracking_provider);
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPO();
  }, [id]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!po) return <div className="p-6">PO not found</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => router.push('/orders')} className="text-indigo-600 mb-4">← กลับไปหน้ารายการ</button>
      
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2">{po.po_number}</h1>
            <p className="text-gray-600">Vendor: <span className="font-medium text-black">{po.vendor}</span></p>
            <p className="text-gray-600">Expected Date: {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '-'}</p>
          </div>
          <div>
             <span className={`px-3 py-1 text-sm rounded-full font-bold ${
                po.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-800' :
                po.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-800' :
                po.status === 'SHIPPED' ? 'bg-purple-100 text-purple-800' :
                po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {po.status}
              </span>
          </div>
        </div>

        {po.vendor_note && (
          <div className="bg-yellow-50 p-4 rounded-lg mb-6 border border-yellow-200">
            <h3 className="font-bold text-yellow-800 mb-1">หมายเหตุจาก Vendor</h3>
            <p className="text-sm text-yellow-700">{po.vendor_note}</p>
          </div>
        )}

        <h3 className="font-bold text-lg mb-4">รายการน้ำยา (Items)</h3>
        <table className="min-w-full divide-y divide-gray-200 mb-6 border">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Item ID</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Ordered</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Received</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {po.items?.map((item: any) => (
              <tr key={item.id}>
                <td className="px-4 py-2 text-sm">{item.item_id}</td>
                <td className="px-4 py-2 text-sm">{item.item_name}</td>
                <td className="px-4 py-2 text-sm text-right">{item.quantity} {item.unit}</td>
                <td className="px-4 py-2 text-sm text-right font-medium text-green-600">{item.received_qty} {item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tracking && (
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-indigo-500">
          <h2 className="text-xl font-bold mb-4">🚚 การจัดส่ง (Tracking)</h2>
          <div className="flex gap-4 mb-6">
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Provider</p>
              <p className="font-bold">{tracking.provider}</p>
            </div>
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Tracking No</p>
              <p className="font-bold">{tracking.trackingNo}</p>
            </div>
            <div className="flex-1 bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-bold text-indigo-600">{tracking.statusText}</p>
            </div>
          </div>

          <div className="relative border-l-2 border-indigo-200 ml-4 pl-6 space-y-6">
            {tracking.history?.map((event: any, i: number) => (
              <div key={i} className="relative">
                <div className="absolute w-4 h-4 bg-indigo-500 rounded-full -left-[31px] top-1 border-4 border-white"></div>
                <p className="text-sm text-gray-500 mb-1">{new Date(event.timestamp).toLocaleString()}</p>
                <p className="font-bold">{event.status}</p>
                <p className="text-sm text-gray-600">{event.location}</p>
                {event.description && <p className="text-xs text-gray-400 mt-1">{event.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
