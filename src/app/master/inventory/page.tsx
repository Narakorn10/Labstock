'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { apiClient, Reagent, Lot } from '@/lib/api-client';
import Modal from '@/components/modal';
import { Search, Package, AlertTriangle, Edit2, Loader2, Database, Calendar, XCircle } from 'lucide-react';
import MultiSelect from '@/components/multi-select';

interface LotWithInfo extends Lot {
  itemId: string;
  itemName: string;
  reagentType: string;
  jobType: string;
  unit: string;
}

export default function InventoryManagementPage() {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string[]>(['ALL']);
  const [filterJob, setFilterJob] = useState<string[]>(['ALL']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLot, setEditingLot] = useState<LotWithInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getDashboard();
      setReagents(data);
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = useMemo(() => {
    const types = new Set(reagents.map(r => r.reagentType));
    const jobs = new Set(reagents.map(r => r.jobType));
    return {
      types: Array.from(types).sort(),
      jobs: Array.from(jobs).sort()
    };
  }, [reagents]);

  const allLots = useMemo(() => {
    const lots: LotWithInfo[] = [];
    reagents.forEach(r => {
      r.lots.forEach(l => {
        lots.push({
          ...l,
          itemId: r.itemId,
          itemName: r.name,
          reagentType: r.reagentType,
          jobType: r.jobType,
          unit: r.unit
        });
      });
    });
    return lots;
  }, [reagents]);

  const filteredLots = useMemo(() => {
    return allLots.filter(l => {
      const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const text = `${l.itemId} ${l.itemName} ${l.lotNo}`.toLowerCase();
      const matchSearch = terms.length === 0 || terms.every(t => text.includes(t));
      
      const matchType = filterType.includes('ALL') || filterType.includes(l.reagentType);
      const matchJob = filterJob.includes('ALL') || filterJob.includes(l.jobType);
      
      return matchSearch && matchType && matchJob;
    });
  }, [allLots, search, filterType, filterJob]);

  const handleReconcile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingLot) return;

    const formData = new FormData(e.currentTarget);
    const newQty = Number(formData.get('newQty'));

    try {
      setSubmitting(true);
      const res = await apiClient.reconcileInventory({
        itemId: editingLot.itemId,
        lotNo: editingLot.lotNo,
        newQty: newQty
      });
      
      if (res.success) {
        setIsModalOpen(false);
        fetchData();
      } else {
        alert(res.error || 'เกิดข้อผิดพลาด');
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">จัดการสต๊อกคลังใหญ่</h1>
          <p className="text-gray-500 text-sm">ตรวจสอบ Lot น้ำยา และปรับปรุงยอดสต๊อกให้ตรงกับของจริง (Inventory Reconciliation)</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/30 space-y-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="ค้นหาชื่อน้ำยา, ID หรือ Lot No..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-medium"
            />
            {search && (
                <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <XCircle size={18} />
                </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MultiSelect 
                label="ประเภทน้ำยา" 
                options={categories.types} 
                selected={filterType} 
                onChange={setFilterType} 
              />
              <MultiSelect 
                label="ประเภทงาน" 
                options={categories.jobs} 
                selected={filterJob} 
                onChange={setFilterJob} 
              />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-gray-500 font-medium border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Item ID / Name</th>
                <th className="px-6 py-4">Lot No. / EXP</th>
                <th className="px-6 py-4 text-center">ยอดในระบบ</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>
              ) : filteredLots.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400">ไม่พบข้อมูล</td></tr>
              ) : filteredLots.map((lot, idx) => (
                <tr key={`${lot.itemId}-${lot.lotNo}-${idx}`} className="hover:bg-gray-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{lot.itemName}</div>
                    <div className="text-xs text-gray-500">ID: {lot.itemId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                        <Database size={14} className="text-gray-400" />
                        {lot.lotNo}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <Calendar size={12} />
                        EXP: {lot.expDate}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center font-black text-blue-600 text-lg">
                    {lot.qty} <span className="text-xs font-bold text-gray-400 uppercase">{lot.unit}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button 
                      onClick={() => { setEditingLot(lot); setIsModalOpen(true); }}
                      className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-all font-bold text-xs border border-amber-200"
                    >
                      <Edit2 size={14} />
                      ปรับยอด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title="ปรับปรุงยอดสต๊อก (Inventory Reconciliation)"
      >
        {editingLot && (
            <form onSubmit={handleReconcile} className="space-y-6">
                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 space-y-2">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">รายการที่ต้องการปรับปรุง</p>
                    <h3 className="font-black text-blue-900 text-lg leading-tight">{editingLot.itemName}</h3>
                    <div className="flex gap-4">
                        <div>
                            <p className="text-[9px] font-bold text-blue-400 uppercase">ID</p>
                            <p className="text-xs font-black text-blue-700">{editingLot.itemId}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-bold text-blue-400 uppercase">Lot No.</p>
                            <p className="text-xs font-black text-blue-700">{editingLot.lotNo}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 text-center">
                    <div className="inline-block px-4 py-1 bg-gray-100 rounded-full text-[10px] font-black text-gray-500 uppercase">ยอดเดิมในระบบ: {editingLot.qty} {editingLot.unit}</div>
                    <div className="space-y-2">
                        <label className="text-sm font-black text-gray-700 uppercase tracking-widest">ระบุยอดที่นับได้จริง</label>
                        <input 
                            name="newQty" 
                            type="number" 
                            required 
                            min="0"
                            step="any"
                            autoFocus
                            defaultValue={editingLot.qty}
                            className="w-full border-2 border-blue-600 rounded-[2rem] px-8 py-6 text-center font-black text-4xl text-blue-600 focus:bg-blue-50/50 transition outline-none" 
                        />
                    </div>
                    <p className="text-xs text-amber-600 font-bold bg-amber-50 p-3 rounded-xl border border-amber-100">
                        <AlertTriangle size={14} className="inline mr-1" />
                        การปรับยอดนี้จะมีผลกับสต๊อกคลังใหญ่ทันที และจะถูกบันทึกประวัติการแก้ไขโดยชื่อของคุณ
                    </p>
                </div>

                <div className="flex gap-3 pt-2">
                    <button 
                        type="button" 
                        onClick={() => setIsModalOpen(false)}
                        className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 rounded-2xl hover:bg-gray-50 transition-all font-bold text-sm"
                    >
                        ยกเลิก
                    </button>
                    <button 
                        type="submit"
                        disabled={submitting}
                        className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg font-black text-sm uppercase flex items-center justify-center gap-2"
                    >
                        {submitting && <Loader2 size={18} className="animate-spin" />}
                        ยืนยันปรับยอด
                    </button>
                </div>
            </form>
        )}
      </Modal>
    </div>
  );
}
