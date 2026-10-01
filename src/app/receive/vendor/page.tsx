'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Truck, CheckCircle2, XCircle, Loader2, Search } from 'lucide-react';

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

  const handleAction = async (shipment: Shipment, action: 'receive' | 'cancel') => {
    if (!confirm(`ยืนยันการ${action === 'receive' ? 'รับเข้าสต๊อก' : 'ยกเลิกรายการ'} ใช่หรือไม่?`)) return;

    let quantities: { accepted_qty: number; rejected_qty: number; rejection_reason?: string } | undefined;
    if (action === 'receive') {
      const accepted = Number(window.prompt(`จำนวนที่รับผ่าน (เต็มจำนวน ${shipment.quantity})`, String(shipment.quantity)));
      const rejected = Number(window.prompt('จำนวนที่เสีย/ไม่ผ่าน', '0'));
      if (!Number.isFinite(accepted) || !Number.isFinite(rejected)) return;
      const reason = rejected > 0 ? window.prompt('เหตุผลของของเสีย/ไม่ผ่าน')?.trim() : undefined;
      if (rejected > 0 && !reason) return;
      quantities = { accepted_qty: accepted, rejected_qty: rejected, rejection_reason: reason };
    }

    setProcessingId(shipment.id);
    try {
      const result = await apiClient.updateShipment(shipment.id, action, quantities);
      
      if (result.success) {
        alert(result.message);
        fetchShipments();
      } else {
        alert(result.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; code?: string } } };
      if (action === 'receive' && quantities && error.response?.data?.code === 'SHELF_LIFE_BELOW_MINIMUM') {
        // Short-dated lot: the Lab either rejects it or records why it accepts it as an exception.
        const overrideReason = window.prompt(`${error.response.data.error}\n\nระบุเหตุผลถ้าจะรับแบบยกเว้น (เว้นว่าง = ไม่รับ)`)?.trim();
        if (overrideReason) {
          try {
            const retried = await apiClient.updateShipment(shipment.id, action, { ...quantities, shelf_life_override_reason: overrideReason });
            alert(retried.message);
            fetchShipments();
          } catch (retryErr: unknown) {
            const retryError = retryErr as { response?: { data?: { error?: string } } };
            alert(retryError.response?.data?.error || 'ดำเนินการไม่สำเร็จ');
          }
        }
        return;
      }
      const msg = error.response?.data?.error || 'ดำเนินการไม่สำเร็จ';
      alert(msg);
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = shipments.filter(s => 
    (s.reagent_name?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (s.vendor?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (s.reference_no?.toLowerCase() || '').includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div>
        <h1 className="text-[32px] leading-tight font-medium text-ink">รับสินค้าจากบริษัท (Vendor Receipt)</h1>
        <p className="mt-1.5 text-[15px] text-gray-600">ตรวจ Lot วันหมดอายุ และจำนวนที่บริษัทแจ้งส่ง ก่อนรับเข้าคลัง</p>
      </div>

      <label className="relative block">
        <span className="sr-only">ค้นหารายการจัดส่ง</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
        <input
          type="text"
          placeholder="ค้นหาตามชื่อบริษัท, เลขใบส่งของ หรือชื่อน้ำยา..."
          className="min-h-[38px] w-full rounded-[10px] border border-line bg-white py-[7px] pl-9 pr-3 text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <div className="flex flex-col gap-3.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="animate-spin text-gray-600" size={32} />
            <p className="text-sm text-gray-600">กำลังตรวจสอบรายการจัดส่ง...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white p-8 text-gray-600">ไม่พบรายการสินค้าที่กำลังจัดส่งในขณะนี้</div>
        ) : (
          filtered.map((ship, idx) => (
            <section key={ship.id ?? idx} className="rounded-2xl border border-line bg-white px-5 py-[18px]">
              <div className="flex flex-wrap items-center gap-3">
                <span aria-hidden="true" className="grid size-[38px] shrink-0 place-items-center rounded-[10px] bg-gray-200 text-ink">
                  <Truck size={18} />
                </span>
                <div className="min-w-0 flex-[1_1_260px]">
                  <div className="font-semibold">{ship.reagent_name}</div>
                  <div className="text-xs text-gray-600">{ship.vendor} · Ref: {ship.reference_no}</div>
                </div>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-warn-bg px-2.5 py-[3px] text-xs font-medium text-warn">กำลังจัดส่ง</span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-[#fafafa] px-4 py-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-gray-600">Lot</dt><dd className="font-medium">{ship.lot_no || '-'}</dd></div>
                <div><dt className="text-xs text-gray-600">EXP</dt><dd className="font-medium">{ship.exp_date || '-'}</dd></div>
                <div><dt className="text-xs text-gray-600">จำนวน</dt><dd className="font-semibold">{ship.quantity} {ship.unit}</dd></div>
              </dl>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleAction(ship, 'cancel')}
                  disabled={processingId === ship.id}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-crit transition hover:bg-crit-bg disabled:cursor-not-allowed disabled:opacity-50"
                  title="ยกเลิกรายการ"
                >
                  <XCircle size={16} />
                  ยกเลิกรายการ
                </button>
                <button
                  type="button"
                  onClick={() => handleAction(ship, 'receive')}
                  disabled={processingId === ship.id}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-4 py-[9px] text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {processingId === ship.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                  ยืนยันการรับของ
                </button>
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
