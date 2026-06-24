'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient, Reagent, BatchItem } from '@/lib/api-client';
import { 
  Search, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  ArrowRightLeft,
  ClipboardList,
  ShoppingCart,
  Smile,
  XCircle,
  Trash2
} from 'lucide-react';
import MultiSelect from '@/components/multi-select';

interface CountItem extends Reagent {
  actual: number | '';
  refilled?: boolean;
  submitting?: boolean;
}

type RefreshOptions = {
  clearActualIds?: string[];
  refilledIds?: string[];
};

export default function CountPage() {
  const [reagents, setReagents] = useState<CountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string[]>(['ALL']);
  const [filterJob, setFilterJob] = useState<string[]>(['ALL']);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  const mergeDashboardState = useCallback((dashboardData: Reagent[], previous: CountItem[], options?: RefreshOptions) => {
    const previousMap = new Map(previous.map(item => [item.itemId, item]));
    const clearActualIds = new Set(options?.clearActualIds || []);
    const refilledIds = new Set(options?.refilledIds || []);

    return dashboardData.map(item => {
      const previousItem = previousMap.get(item.itemId);
      return {
        ...item,
        actual: clearActualIds.has(item.itemId) ? '' : (previousItem?.actual ?? ''),
        refilled: refilledIds.has(item.itemId) ? true : (previousItem?.refilled ?? false),
        submitting: false
      };
    });
  }, []);

  const refreshFromServer = useCallback(async (options?: RefreshOptions) => {
    const dashboardData = await apiClient.getDashboard();
    setReagents(prev => mergeDashboardState(dashboardData, prev, options));
  }, [mergeDashboardState]);

  // Load reagents and restore saved counts
  useEffect(() => {
    apiClient.getDashboard().then(data => {
      // Restore from LocalStorage
      const savedCounts = JSON.parse(localStorage.getItem('labstock_counts') || '{}');
      
      const items = data.map(r => ({
        ...r,
        actual: savedCounts[r.itemId] !== undefined ? savedCounts[r.itemId] : '' as number | '',
        refilled: false,
        submitting: false
      }));
      setReagents(items);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  // Save to LocalStorage whenever counts change
  useEffect(() => {
    if (reagents.length > 0) {
      const countsToSave: Record<string, number | ''> = {};
      reagents.forEach(item => {
        if (item.actual !== '') {
          countsToSave[item.itemId] = item.actual;
        }
      });
      localStorage.setItem('labstock_counts', JSON.stringify(countsToSave));
    }
  }, [reagents]);

  const categories = useMemo(() => {
    const types = new Set(reagents.map(r => r.reagentType));
    const jobs = new Set(reagents.map(r => r.jobType));
    return {
      types: Array.from(types).sort(),
      jobs: Array.from(jobs).sort()
    };
  }, [reagents]);

  const filteredItems = useMemo(() => {
    return reagents.filter(item => {
      const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const text = `${item.itemId} ${item.name} ${item.qrCode || ''}`.toLowerCase();
      const matchSearch = terms.length === 0 || terms.every(t => text.includes(t));
      
      const matchType = filterType.includes('ALL') || filterType.includes(item.reagentType);
      const matchJob = filterJob.includes('ALL') || filterJob.includes(item.jobType);
      
      return matchSearch && matchType && matchJob;
    });
  }, [reagents, search, filterType, filterJob]);

  const countedCount = reagents.filter(i => i.actual !== '').length;
  const progress = reagents.length > 0 ? (countedCount / reagents.length) * 100 : 0;

  const handleInput = (itemId: string, val: string) => {
    const numVal = val === '' ? '' : parseInt(val.replace(/[^0-9]/g, '')) || 0;
    setReagents(prev => prev.map(item => 
      item.itemId === itemId ? { ...item, actual: numVal, refilled: false } : item
    ));
  };

  const syncItems = useMemo(() => {
    return reagents.filter(i => i.actual !== '' && (i.actual as number) < i.weeklyTarget && !i.refilled);
  }, [reagents]);

  const [submittingAll, setSubmittingAll] = useState(false);

  const handleSyncAll = async () => {
    if (syncItems.length === 0) return;
    setSubmittingAll(true);
    
    const batchToDispense: BatchItem[] = [];
    const insufficientItems: string[] = [];

    syncItems.forEach(item => {
      let remainingToDispense = item.weeklyTarget - (item.actual as number);
      const sortedLots = [...item.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
      
      for (const lot of sortedLots) {
        if (remainingToDispense <= 0) break;
        const available = lot.qty;
        const take = Math.min(remainingToDispense, available);
        if (take > 0) {
          batchToDispense.push({
            itemId: item.itemId,
            name: item.name,
            lotNo: lot.lotNo,
            qty: take,
            unit: item.unit,
            expDate: lot.expDate,
            note: "เบิกเติมหน้างาน (Sync รวม)"
          });
          remainingToDispense -= take;
        }
      }
      
      if (remainingToDispense > 0) {
        insufficientItems.push(item.name);
      }
    });

    try {
      if (batchToDispense.length > 0) {
        await apiClient.dispenseBatch(batchToDispense);
        let msg = `Sync สำเร็จ! เบิกเติม ${syncItems.length} รายการเรียบร้อยแล้ว`;
        if (insufficientItems.length > 0) {
          msg += ` (บางรายการสต๊อกไม่พอ: ${insufficientItems.slice(0, 2).join(', ')}...)`;
        }
        setFeedback({ type: 'success', msg });
        
        const syncedIds = syncItems.map(item => item.itemId);
        await refreshFromServer({
          clearActualIds: syncedIds,
          refilledIds: syncedIds
        });
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }, message: string };
      setFeedback({ type: 'error', msg: 'Sync ไม่สำเร็จ: ' + (error.response?.data?.error || error.message) });
    } finally {
      setSubmittingAll(false);
    }
  };

  const handleClearAll = () => {
    if (confirm('คุณต้องการล้างยอดนับทั้งหมดที่พิมพ์ค้างไว้ใช่หรือไม่?')) {
      setReagents(prev => prev.map(item => ({ ...item, actual: '', refilled: false })));
      localStorage.removeItem('labstock_counts');
      setFeedback({ type: 'success', msg: 'ล้างยอดนับทั้งหมดเรียบร้อยแล้ว' });
    }
  };

  const handleRefillSingle = async (itemId: string) => {
    const item = reagents.find(i => i.itemId === itemId);
    if (!item || item.actual === '') return;

    const needed = item.weeklyTarget - (item.actual as number);
    if (needed <= 0) return;

    setReagents(prev => prev.map(i => i.itemId === itemId ? { ...i, submitting: true } : i));
    
    const batchToDispense: BatchItem[] = [];
    const sortedLots = [...item.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
    
    let remainingToDispense = needed;
    let takenTotal = 0;

    for (const lot of sortedLots) {
      if (remainingToDispense <= 0) break;
      const available = lot.qty;
      const take = Math.min(remainingToDispense, available);
      if (take > 0) {
        batchToDispense.push({
          itemId: item.itemId,
          name: item.name,
          lotNo: lot.lotNo,
          qty: take,
          unit: item.unit,
          expDate: lot.expDate,
          note: needed > item.quantity ? `เบิกเติมหน้างาน (สต๊อกไม่พอ: เบิก ${item.quantity} จาก ${needed})` : "เบิกเติมหน้างานอัตโนมัติ"
        });
        remainingToDispense -= take;
        takenTotal += take;
      }
    }

    try {
      if (batchToDispense.length > 0) {
        await apiClient.dispenseBatch(batchToDispense);
        
        let msg = `เติม ${item.name} สำเร็จ! (${takenTotal} ${item.unit})`;
        if (takenTotal < needed) {
          msg = `เติม ${item.name} บางส่วน (${takenTotal}/${needed}) เนื่องจากสต๊อกคลังใหญ่ไม่พอ`;
        }
        
        setFeedback({ type: 'success', msg });
        await refreshFromServer({
          clearActualIds: [itemId],
          refilledIds: [itemId]
        });
      } else {
        setFeedback({ type: 'error', msg: 'สต๊อกในคลังใหญ่ไม่มีรายการนี้เหลืออยู่' });
        setReagents(prev => prev.map(i => i.itemId === itemId ? { ...i, submitting: false } : i));
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } }, message: string };
      setFeedback({ type: 'error', msg: 'Sync ไม่สำเร็จ: ' + (error.response?.data?.error || error.message) });
      setReagents(prev => prev.map(i => i.itemId === itemId ? { ...i, submitting: false } : i));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-blue-600" size={48} />
        <p className="text-gray-500 animate-pulse font-bold text-xs uppercase tracking-widest">กำลังโหลดรายชื่อน้ำยาทั้งหมด...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto pb-40">
      {/* React-style Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 rounded-[2.5rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 -mr-16 -mt-16 rounded-full blur-3xl"></div>
        <div className="relative z-10">
            <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
                        <ClipboardList size={24} />
                    </div>
                    <h1 className="text-2xl font-black">นับสต๊อกหน้างาน</h1>
                </div>
                {countedCount > 0 && (
                    <button 
                        onClick={handleClearAll}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl backdrop-blur-md transition-all text-[10px] font-black uppercase tracking-widest border border-white/10"
                    >
                        <Trash2 size={14} />
                        ล้างยอดนับ
                    </button>
                )}
            </div>
            <p className="text-blue-100 text-sm font-bold opacity-90">คำนวณยอดเบิกเติมอัตโนมัติจากเป้าหมายรายสัปดาห์ (Weekly Target)</p>
            
            <div className="mt-6">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-2 text-blue-100">
                    <span>ความคืบหน้าการนับรวม</span>
                    <span>{countedCount} / {reagents.length} รายการ</span>
                </div>
                <div className="w-full h-2.5 bg-blue-900/30 rounded-full overflow-hidden border border-white/10">
                    <div 
                        className="h-full bg-white rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(255,255,255,0.5)]" 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors" size={18} />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="พิมพ์รหัส ชื่อ หรือแสกนเพื่อค้นหา..."
            className="w-full pl-11 pr-10 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {search && (
              <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <XCircle size={18} />
              </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      {feedback && (
        <div className={`p-4 rounded-[1.5rem] flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
          feedback.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <p className="text-sm font-bold flex-1">{feedback.msg}</p>
          <button onClick={() => setFeedback(null)} className="text-xs font-black uppercase px-2 py-1">ปิด</button>
        </div>
      )}

      {/* Item List */}
      <div className="space-y-4">
        {filteredItems.length === 0 && !loading ? (
            <div className="text-center py-20 text-gray-300 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm animate-in fade-in">
                <ClipboardList className="mx-auto mb-4 opacity-20" size={64} />
                <p className="font-bold">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
            </div>
        ) : (
            filteredItems.map((item, idx) => {
                const target = item.weeklyTarget || 0;
                const current = item.actual;
                let diff = 0;
                if (current !== '' && current < target) {
                    diff = target - current;
                }

                return (
                    <div key={`${item.itemId}-${idx}`} className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm transition-all focus-within:ring-2 focus-within:ring-blue-500/20 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex justify-between items-start mb-5 border-b border-gray-50 pb-4">
                            <div className="pr-4 min-w-0">
                                <h3 className="font-black text-gray-800 text-base leading-tight mb-1 truncate">{item.name}</h3>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter bg-gray-50 px-1.5 py-0.5 rounded">ID: {item.itemId}</span>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter bg-gray-50 px-1.5 py-0.5 rounded">{item.reagentType}</span>
                                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter bg-blue-50/50 px-1.5 py-0.5 rounded">{item.jobType}</span>
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <div className="bg-blue-50 px-3 py-2 rounded-xl text-center border border-blue-100">
                                    <p className="text-[8px] text-blue-400 font-black uppercase tracking-widest mb-0.5">ในระบบ</p>
                                    <p className="font-black text-blue-700 text-sm">{item.quantity} <span className="text-[10px] font-bold">{item.unit}</span></p>
                                </div>
                                <div className="bg-gray-50 px-3 py-2 rounded-xl text-center border border-gray-100">
                                    <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest mb-0.5">เป้าหมาย</p>
                                    <p className="font-black text-gray-700 text-sm">{target} <span className="text-[10px] font-bold">{item.unit}</span></p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-4">
                            <div className="w-full sm:flex-1 relative">
                                <label className="absolute -top-2 left-4 bg-white px-1 text-[9px] font-black text-blue-600 uppercase tracking-widest">นับได้จริง</label>
                                <input 
                                    type="number" 
                                    min="0"
                                    value={item.actual}
                                    onChange={(e) => handleInput(item.itemId, e.target.value)}
                                    placeholder="ระบุจำนวน"
                                    className="w-full border border-blue-200 rounded-2xl px-5 py-4 text-center font-black text-xl text-blue-900 focus:bg-blue-50/50 transition outline-none" 
                                />
                            </div>
                            <div className="w-full sm:flex-1 flex flex-col justify-end">
                                {item.refilled ? (
                                    <div className="w-full bg-green-50 text-green-600 py-4 rounded-2xl font-black text-sm text-center border border-green-100 flex justify-center items-center gap-2 animate-in zoom-in-95 duration-300">
                                        <CheckCircle size={18} /> เติมสต๊อกแล้ว
                                    </div>
                                ) : diff > 0 ? (
                                    <button
                                        onClick={() => handleRefillSingle(item.itemId)}
                                        disabled={item.submitting}
                                        className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-sm text-center shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:active:scale-100"
                                    >
                                        {item.submitting ? (
                                            <Loader2 size={18} className="animate-spin" />
                                        ) : (
                                            <ShoppingCart size={18} />
                                        )}
                                        {item.quantity < diff ? (
                                            <span className="flex flex-col text-[10px] leading-tight text-left">
                                                <span>เบิกเท่าที่มี ({item.quantity})</span>
                                                <span className="opacity-70 font-bold">ต้องการ {diff}</span>
                                            </span>
                                        ) : (
                                            `กดเบิกเติม ${diff} ${item.unit}`
                                        )}
                                    </button>
                                ) : item.actual !== '' ? (
                                    <div className="w-full bg-green-50 text-green-600 py-4 rounded-2xl font-black text-sm text-center border border-green-100 flex justify-center items-center gap-2">
                                        <Smile size={18} /> สต๊อกหน้างานพอใช้
                                    </div>
                                ) : (
                                    <div className="w-full bg-gray-50 text-gray-400 py-4 rounded-2xl font-bold text-sm text-center border border-gray-100 flex justify-center items-center gap-2 opacity-50">
                                        รอนับรายการนี้
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            })
        )}
      </div>

      {/* Fixed Sync All Button (Cart) */}
      {syncItems.length > 0 && (
        <div className="fixed bottom-8 left-0 right-0 px-4 z-40 animate-in slide-in-from-bottom-10 duration-500">
          <div className="max-w-md mx-auto">
            <button 
              onClick={handleSyncAll}
              disabled={submittingAll}
              className="w-full bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-2xl flex items-center justify-between gap-4 active:scale-95 transition-all hover:bg-gray-800 border-2 border-white/10"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/50">
                  <ArrowRightLeft size={24} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">ในตะกร้าเบิกเติม</p>
                  <p className="text-xl font-black">{syncItems.length} รายการ</p>
                </div>
              </div>
              <div className="bg-white/10 px-6 py-3 rounded-2xl font-black text-sm flex items-center gap-2 backdrop-blur-md">
                {submittingAll ? <Loader2 className="animate-spin" size={20} /> : 'Sync เบิกทั้งหมด'}
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
