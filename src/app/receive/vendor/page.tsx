'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Truck, CheckCircle2, XCircle, Loader2, Package, Search } from 'lucide-react';

interface Shipment {
  id: number;
  vendor: string;
  reference_no: string;
  reagent_name: string;
  lot_no: string;
  exp_date: string;
  quantity: number;
  unit: string;
  status: 'In Transit' | 'Received' | 'Cancelled';
}

export default function LabVendorReceiptPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.getShipments();
      
      if (Array.isArray(data)) {
        // Only show 'In Transit' items for receipt
        setShipments(data.filter((s: Shipment) => s.status === 'In Transit'));
      } else {
        console.error('Expected array but got:', data);
        setShipments([]);
      }
    } catch (err: unknown) {
      console.error(err);
      const error = err as { response?: { data?: { error?: string } } };
      const msg = error.response?.data?.error || 'ไม่สามารถดึงข้อมูลรายการส่งมอบได้';
      alert(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (isMounted) {
        await fetchShipments();
      }
    };
    load();
    return () => { isMounted = false; };
  }, [fetchShipments]);

  const handleAction = async (id: number, action: 'receive' | 'cancel') => {
    if (!confirm(`ยืนยันการ${action === 'receive' ? 'รับเข้าสต๊อก' : 'ยกเลิกรายการ'} ใช่หรือไม่?`)) return;

    setProcessingId(id);
    try {
      const result = await apiClient.updateShipment(id, action);
      
      if (result.success) {
        alert(result.message);
        fetchShipments();
      } else {
        alert(result.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      const msg = error.response?.data?.error || 'ดำเนินการไม่สำเร็จ';
      alert(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = shipments.filter(s => 
    s.reagent_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.vendor?.toLowerCase().includes(search.toLowerCase()) ||
    s.reference_no?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">รับสินค้าจากบริษัท (Vendor Receipt)</h1>
        <p className="text-gray-500 text-sm font-bold mt-1">ยืนยันรายการน้ำยาที่บริษัทแจ้งส่งมอบล่วงหน้า เพื่อเข้าสต๊อกจริง</p>
      </div>

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="ค้นหาตามชื่อบริษัท, เลขใบส่งของ หรือชื่อน้ำยา..."
            className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl border-none outline-none font-bold text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-blue-600" size={40} />
            <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">กำลังตรวจสอบรายการจัดส่ง...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center gap-4 bg-white rounded-[2.5rem] border border-dashed border-gray-200">
             <Package className="text-gray-200" size={64} />
             <p className="text-gray-400 font-bold italic">ไม่พบรายการสินค้าที่กำลังจัดส่งในขณะนี้</p>
          </div>
        ) : (
          filtered.map((ship, idx) => (
            <div key={idx} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row items-center justify-between gap-6 group">
              <div className="flex items-center gap-6 w-full">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Truck size={32} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black px-2 py-0.5 bg-blue-100 text-blue-600 rounded uppercase">{ship.vendor}</span>
                    <span className="text-[10px] font-black px-2 py-0.5 bg-gray-100 text-gray-500 rounded uppercase">Ref: {ship.reference_no}</span>
                  </div>
                  <h3 className="text-lg font-black text-gray-900 leading-tight">{ship.reagent_name}</h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Lot: <span className="text-gray-900">{ship.lot_no}</span></p>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Exp: <span className="text-gray-900">{ship.exp_date}</span></p>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-tighter">จำนวน: <span className="text-blue-600 font-black">{ship.quantity} {ship.unit}</span></p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto shrink-0 border-t md:border-t-0 pt-4 md:pt-0">
                <button
                  onClick={() => handleAction(ship.id, 'cancel')}
                  disabled={processingId === ship.id}
                  className="flex-1 md:flex-none p-4 text-red-400 hover:bg-red-50 rounded-2xl transition-colors"
                  title="ยกเลิกรายการ"
                >
                  <XCircle size={24} />
                </button>
                <button
                  onClick={() => handleAction(ship.id, 'receive')}
                  disabled={processingId === ship.id}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-8 py-4 bg-green-600 text-white rounded-2xl shadow-lg shadow-green-100 hover:bg-green-700 transition-all font-black text-sm uppercase tracking-widest"
                >
                  {processingId === ship.id ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                  ยืนยันการรับของ
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
