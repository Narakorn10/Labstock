"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [vendor, setVendor] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<{item_id: string, item_name: string, quantity: number, unit: string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/purchase-orders');
      if (res.ok) {
        setOrders(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const loadSuggestions = async () => {
    setSuggestLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/suggest${vendor ? `?vendor=${vendor}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        const suggestedItems = data.map((d: any) => ({
          item_id: d.item_id,
          item_name: d.name,
          quantity: d.suggested_order_qty,
          unit: d.unit
        }));
        setItems(suggestedItems);
        if (!vendor && data.length > 0) {
          setVendor(data[0].vendor);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor,
          expected_date: expectedDate,
          note,
          items
        })
      });

      if (res.ok) {
        setShowCreateModal(false);
        setVendor("");
        setExpectedDate("");
        setNote("");
        setItems([]);
        fetchOrders();
      } else {
        alert("Failed to create PO");
      }
    } catch (e) {
      console.error(e);
      alert("Error creating PO");
    } finally {
      setLoading(false);
    }
  };

  const addItemRow = () => {
    setItems([...items, { item_id: "", item_name: "", quantity: 1, unit: "box" }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Purchase Orders (สั่งซื้อน้ำยา)</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => router.push('/orders/tracking')}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            🚚 ติดตามพัสดุ
          </button>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            + สร้างใบสั่งซื้อ
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">PO Number</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {orders.map(po => (
              <tr key={po.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium">{po.po_number}</td>
                <td className="px-6 py-4">{po.vendor}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    po.status === 'SUBMITTED' ? 'bg-yellow-100 text-yellow-800' :
                    po.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-800' :
                    po.status === 'SHIPPED' ? 'bg-purple-100 text-purple-800' :
                    po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {po.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {po.items?.length || 0} รายการ
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(po.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-sm font-medium">
                  <button 
                    onClick={() => router.push(`/orders/${po.id}`)}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    ดูรายละเอียด
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">สร้างใบสั่งซื้อ (Create PO)</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor (บริษัท)*</label>
                <input 
                  type="text" 
                  value={vendor} 
                  onChange={e => setVendor(e.target.value)}
                  className="w-full border rounded p-2"
                  placeholder="เช่น DKSH"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Date (วันที่คาดว่าจะส่ง)</label>
                <input 
                  type="date" 
                  value={expectedDate} 
                  onChange={e => setExpectedDate(e.target.value)}
                  className="w-full border rounded p-2"
                />
              </div>
            </div>

            <div className="mb-4 flex justify-between items-center">
              <h3 className="font-bold">รายการน้ำยา</h3>
              <div className="flex gap-2">
                <button 
                  onClick={loadSuggestions}
                  disabled={suggestLoading}
                  className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm hover:bg-yellow-200"
                >
                  {suggestLoading ? 'Loading...' : '🤖 แนะนำอัตโนมัติ (จาก Min Stock)'}
                </button>
                <button 
                  onClick={addItemRow}
                  className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200"
                >
                  + เพิ่มแถว
                </button>
              </div>
            </div>

            {items.map((item, index) => (
              <div key={index} className="flex gap-2 mb-2 items-center">
                <input 
                  placeholder="Item ID" 
                  value={item.item_id}
                  onChange={e => updateItem(index, 'item_id', e.target.value)}
                  className="border rounded p-2 w-1/4"
                />
                <input 
                  placeholder="ชื่อน้ำยา" 
                  value={item.item_name}
                  onChange={e => updateItem(index, 'item_name', e.target.value)}
                  className="border rounded p-2 flex-1"
                />
                <input 
                  type="number" 
                  placeholder="จำนวน" 
                  value={item.quantity}
                  onChange={e => updateItem(index, 'quantity', parseInt(e.target.value))}
                  className="border rounded p-2 w-24"
                />
                <input 
                  placeholder="หน่วย" 
                  value={item.unit}
                  onChange={e => updateItem(index, 'unit', e.target.value)}
                  className="border rounded p-2 w-24"
                />
                <button onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700 p-2">✕</button>
              </div>
            ))}

            {items.length === 0 && (
              <div className="text-center py-8 text-gray-500 bg-gray-50 rounded border border-dashed">
                ยังไม่มีรายการน้ำยา กดปุ่ม + เพิ่มแถว หรือ แนะนำอัตโนมัติ
              </div>
            )}

            <div className="mt-6 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุเพิ่มเติม</label>
              <textarea 
                value={note} 
                onChange={e => setNote(e.target.value)}
                className="w-full border rounded p-2"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6 border-t pt-4">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleCreate}
                disabled={loading || items.length === 0 || !vendor}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'กำลังบันทึก...' : 'บันทึกและส่ง PO ไปยัง Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
