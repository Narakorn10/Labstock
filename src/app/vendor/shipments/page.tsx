'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';
import { FileUp, Truck, CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react';

export default function VendorShipmentsPage() {
  const { user } = useAuth();
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchShipments();
  }, []);

  const fetchShipments = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getShipments();
      if (Array.isArray(data)) {
        setShipments(data);
      } else {
        setShipments([]);
      }
    } catch (err) {
      console.error(err);
      setShipments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.split('\n').filter(line => line.trim());
        
        // Expected CSV: itemId, lotNo, expDate, qty, referenceNo
        const items = rows.slice(1).map(row => {
          const values = row.split(',').map(s => s.trim());
          return {
            itemId: values[0],
            lotNo: values[1],
            expDate: values[2],
            qty: parseFloat(values[3]) || 0
          };
        }).filter(item => item.itemId && item.qty > 0);

        if (items.length === 0) throw new Error('ไม่พบข้อมูลที่ถูกต้องในไฟล์');

        // Extract referenceNo from first row of data or a fixed index
        const referenceNo = rows[1].split(',')[4]?.trim() || `SHIP-${Date.now()}`;

        const result = await apiClient.uploadShipments(items, referenceNo);
        
        if (result.success) {
          alert(result.message);
          fetchShipments();
        } else {
          alert(result.error || 'เกิดข้อผิดพลาด');
        }
      } catch (err: any) {
        alert(err.message || 'นำเข้าข้อมูลไม่สำเร็จ');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">แจ้งส่งสินค้า (Vendor Portal)</h1>
          <p className="text-gray-500 text-sm font-bold">แจ้งเลข Lot และวันหมดอายุล่วงหน้าเพื่อให้ห้องแล็บรับของได้ทันที</p>
        </div>
        
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".csv" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all font-black text-sm uppercase tracking-widest disabled:bg-blue-300"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <FileUp size={20} />}
            อัปโหลดใบส่งของ (CSV)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Company</p>
          <p className="text-2xl font-black text-blue-600">{user?.company || 'Vendor'}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">In Transit</p>
            <p className="text-2xl font-black text-gray-900">{shipments.filter(s => s.status === 'In Transit').length}</p>
          </div>
          <Truck className="text-amber-400" size={32} />
        </div>
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest mb-1">Success</p>
            <p className="text-2xl font-black text-gray-900">{shipments.filter(s => s.status === 'Received').length}</p>
          </div>
          <CheckCircle2 className="text-green-400" size={32} />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 bg-gray-50/30">
          <h2 className="font-black text-gray-800 text-xl flex items-center gap-2">
            <Clock className="text-blue-500" size={24} />
            ประวัติการแจ้งส่งสินค้า
          </h2>
        </div>
        
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-blue-600" size={40} />
            <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">กำลังดึงข้อมูล...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">วันที่แจ้ง</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Ref No.</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">รายการน้ำยา</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">จำนวน</th>
                  <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shipments.map((ship, idx) => {
                  const isInTransit = ship.status === 'In Transit';
                  const isReceived = ship.status === 'Received';
                  return (
                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-8 py-4 whitespace-nowrap">
                        <p className="font-bold text-gray-900 text-xs">{new Date(ship.created_at).toLocaleDateString('th-TH')}</p>
                      </td>
                      <td className="px-8 py-4">
                        <span className="text-[10px] font-black px-2 py-1 bg-gray-100 rounded-lg text-gray-600 uppercase">{ship.reference_no}</span>
                      </td>
                      <td className="px-8 py-4">
                        <p className="font-bold text-gray-800 text-sm">{ship.reagent_name}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Lot: {ship.lot_no} | Exp: {ship.exp_date}</p>
                      </td>
                      <td className="px-8 py-4 text-center">
                        <span className="font-black text-gray-900 text-lg">{ship.quantity}</span>
                        <span className="text-[9px] font-bold text-gray-400 ml-1 uppercase">{ship.unit}</span>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <span className={`
                          inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-black uppercase
                          ${isInTransit ? 'bg-amber-100 text-amber-700' : isReceived ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
                        `}>
                          {isInTransit ? 'In Transit' : isReceived ? 'Received' : 'Cancelled'}
                        </span>
                        {isReceived && (
                          <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase">โดย {ship.received_by}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shipments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-gray-400 font-bold italic text-sm">
                       ยังไม่มีประวัติการแจ้งส่งสินค้า
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
