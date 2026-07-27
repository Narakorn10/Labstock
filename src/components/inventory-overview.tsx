'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  Clock,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { apiClient, Reagent } from '@/lib/api-client';
import ReportModal from '@/components/report-modal';
import ReagentDetailModal from '@/components/reagent-detail-modal';
import { useAuth } from '@/components/auth-provider';

type InventoryFilter = 'all' | 'low' | 'nearExpiry' | 'expired';

export default function InventoryOverview() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJobType, setSelectedJobType] = useState<string>('ทั้งหมด');
  const [selectedReagentType, setSelectedReagentType] = useState<string>('ทั้งหมด');
  const [selectedReagent, setSelectedReagent] = useState<Reagent | null>(null);
  const [statusFilter, setStatusFilter] = useState<InventoryFilter>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dashData = await apiClient.getDashboard();
      setReagents(dashData);
    } catch (err) {
      console.error('Inventory overview fetch error:', err);
      setError('ไม่สามารถโหลดข้อมูลภาพรวมคลังได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || typeof window === "undefined") {
      return;
    }

    const token = window.localStorage.getItem("labstock_token");
    if (!token) {
      return;
    }

    let isMounted = true;

    const load = async () => {
      if (isMounted) {
        await fetchData();
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [authLoading, fetchData, user]);

  const stats = useMemo(() => {
    const total = reagents.length;
    const low = reagents.filter((r) => r.quantity <= r.minThreshold).length;
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);

    let expired = 0;
    let nearExpiry = 0;

    reagents.forEach((reagent) => {
      reagent.lots.forEach((lot) => {
        const exp = new Date(lot.expDate);
        if (exp < now) {
          expired += 1;
        } else if (exp < thirtyDays) {
          nearExpiry += 1;
        }
      });
    });

    return [
      { name: 'รายการคงคลัง', value: total, icon: Package, color: 'text-[#2f6f67]', bg: 'bg-[#eff6f3]', filter: 'all' as InventoryFilter },
      { name: 'ต่ำกว่าจุดสั่งซื้อ', value: low, icon: AlertTriangle, color: 'text-[#a86616]', bg: 'bg-[#fff7e8]', filter: 'low' as InventoryFilter },
      { name: 'ใกล้หมดอายุ', value: nearExpiry, icon: Clock, color: 'text-[#a86616]', bg: 'bg-[#fff7e8]', filter: 'nearExpiry' as InventoryFilter },
      { name: 'Lot หมดอายุ', value: expired, icon: XCircle, color: 'text-[#b42318]', bg: 'bg-[#fff1f0]', filter: 'expired' as InventoryFilter },
    ];
  }, [reagents]);

  const jobTypes = useMemo(() => {
    const types = Array.from(new Set(reagents.map((r) => r.jobType).filter(Boolean)));
    return ['ทั้งหมด', ...types];
  }, [reagents]);

  const reagentTypes = useMemo(() => {
    const types = Array.from(new Set(reagents.map((r) => r.reagentType).filter(Boolean)));
    return ['ทั้งหมด', ...types];
  }, [reagents]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return reagents.filter((item) => {
      const matchSearch =
        normalizedSearch === '' ||
        `${item.itemId} ${item.name}`.toLowerCase().includes(normalizedSearch);
      const matchJob = selectedJobType === 'ทั้งหมด' || item.jobType === selectedJobType;
      const matchType = selectedReagentType === 'ทั้งหมด' || item.reagentType === selectedReagentType;
      const now = new Date();
      const nearExpiryDate = new Date();
      nearExpiryDate.setDate(nearExpiryDate.getDate() + 30);
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'low' && item.quantity <= item.minThreshold) ||
        (statusFilter === 'nearExpiry' && item.lots.some((lot) => {
          const expiryDate = new Date(lot.expDate);
          return expiryDate >= now && expiryDate < nearExpiryDate;
        })) ||
        (statusFilter === 'expired' && item.lots.some((lot) => new Date(lot.expDate) < now));

      return matchSearch && matchJob && matchType && matchStatus;
    });
  }, [reagents, searchTerm, selectedJobType, selectedReagentType, statusFilter]);

  const isPowerUser = user?.role === 'Admin' || user?.role === 'Manager';
  const formatReceivedDate = (value?: string) => {
    if (!value) return '-';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  if (loading && reagents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="animate-spin text-[#2f6f67]" size={42} />
        <p className="text-[#687875] animate-pulse font-medium text-sm">
          กำลังโหลดข้อมูลคลังน้ำยา
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-3 duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <p className="text-xs font-semibold text-[#2f6f67] tracking-[0.12em] mb-2">ภาพรวมระบบ</p>
          <h1 className="text-3xl font-semibold text-[#1d302f] tracking-tight">
            คลังน้ำยา
          </h1>
          <p className="text-[#687875] text-sm mt-2 max-w-2xl leading-6">
            ติดตามปริมาณคงเหลือ รายการที่ต้องสั่งซื้อ และอายุของ lot เพื่อเตรียมงานได้ทันเวลา
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-[#425451] border border-[#d9e3df] hover:bg-[#f2f7f5] transition-all font-semibold text-sm rounded-lg"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
          <button
            onClick={() => setReportModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#123b3a] text-white hover:bg-[#0d302f] transition-all font-semibold text-sm rounded-lg shadow-lg shadow-[#123b3a]/15"
          >
            <FileText size={16} />
            รายงานประจำวัน
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#fff1f0] border border-[#f3c6c2] p-4 rounded-lg flex items-center gap-3 text-[#b42318]">
          <AlertTriangle size={20} />
          <p className="text-xs font-bold">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <button
            key={stat.name}
            type="button"
            onClick={() => setStatusFilter((current) => current === stat.filter ? 'all' : stat.filter)}
            aria-pressed={statusFilter === stat.filter}
            className={`text-left bg-white p-5 rounded-xl border transition-all duration-200 shadow-[0_12px_30px_-28px_rgba(18,59,58,0.75)] hover:-translate-y-0.5 hover:border-[#8cbab0] active:translate-y-0 ${statusFilter === stat.filter ? 'border-[#2f6f67] ring-2 ring-[#2f6f67]/15' : 'border-[#d9e3df]'}`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-11 h-11 ${stat.bg} ${stat.color} rounded-lg flex items-center justify-center`}>
                <stat.icon size={21} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xs font-medium text-[#687875]">{stat.name}</p>
                <p className="text-2xl font-semibold text-[#1d302f]">{stat.value}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#d9e3df] rounded-xl flex flex-col overflow-hidden shadow-[0_14px_36px_-30px_rgba(18,59,58,0.7)]">
        <div className="p-5 md:p-6 border-b border-[#e5ece9] space-y-4">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 bg-[#2f6f67] rounded-full" />
              <div>
                <h2 className="text-lg font-semibold text-[#1d302f]">รายการคงคลังปัจจุบัน</h2>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="mt-1 text-xs font-medium text-[#2f6f67] hover:text-[#123b3a] underline underline-offset-2"
                  >
                    แสดงทุกสถานะ
                  </button>
                )}
              </div>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="ค้นหาชื่อน้ำยา หรือรหัสรายการ"
                className="w-full pl-11 pr-4 py-3 bg-[#f4f7f6] rounded-lg text-sm font-medium text-[#1d302f] border border-transparent focus:bg-white focus:border-[#8cbab0] outline-none transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <section aria-label="ตัวกรองรายการคงคลัง" className="rounded-lg border border-[#d9e3df] bg-[#f7faf8] p-3 md:p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[#425451]">กรองรายการ</p>
              {(selectedJobType !== 'ทั้งหมด' || selectedReagentType !== 'ทั้งหมด') && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJobType('ทั้งหมด');
                    setSelectedReagentType('ทั้งหมด');
                  }}
                  className="text-xs font-medium text-[#2f6f67] hover:text-[#123b3a] underline underline-offset-2 shrink-0"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <div className="space-y-1.5">
                <label htmlFor="job-filter" className="text-xs font-medium text-[#687875]">
                  งาน
                </label>
                <select
                  id="job-filter"
                  value={selectedJobType}
                  onChange={(event) => setSelectedJobType(event.target.value)}
                  className="w-full h-11 px-3 bg-white text-sm font-medium text-[#1d302f] border border-[#d9e3df] rounded-lg shadow-sm cursor-pointer transition-colors hover:border-[#8cbab0] focus:border-[#2f6f67]"
                >
                  {jobTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reagent-type-filter" className="text-xs font-medium text-[#687875]">
                  ประเภท
                </label>
                <select
                  id="reagent-type-filter"
                  value={selectedReagentType}
                  onChange={(event) => setSelectedReagentType(event.target.value)}
                  className="w-full h-11 px-3 bg-white text-sm font-medium text-[#1d302f] border border-[#d9e3df] rounded-lg shadow-sm cursor-pointer transition-colors hover:border-[#8cbab0] focus:border-[#2f6f67]"
                >
                  {reagentTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>

        <div className="flex-1 overflow-auto max-h-[680px] no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-[#f4f7f6] sticky top-0 z-10 border-b border-[#d9e3df]">
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-[#52635f] tracking-wide">รายการ / รหัส</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-[#52635f] tracking-wide">งาน / ประเภท</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-[#52635f] tracking-wide">Lot ที่พร้อมใช้</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-[#52635f] tracking-wide text-center">คงเหลือ</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-[#52635f] tracking-wide text-right">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400 font-bold">
                    ไม่พบรายการคงคลังตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isLow = item.quantity <= item.minThreshold;

                  return (
                    <tr
                      key={item.itemId}
                      onClick={() => setSelectedReagent(item)}
                      className="hover:bg-[#eff6f3] transition-colors group cursor-pointer"
                    >
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-semibold text-[#1d302f] group-hover:text-[#2f6f67] transition-colors line-clamp-1">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold mt-0.5 uppercase tracking-tighter">
                          รหัสรายการ: {item.itemId}
                        </p>
                      </td>
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-bold text-gray-700">{item.jobType || '-'}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                          {item.reagentType || '-'}
                        </p>
                      </td>
                      <td className="px-6 md:px-8 py-5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.lots?.slice(0, 4).map((lot) => {
                            const isExpired = new Date(lot.expDate) < new Date();
                            return (
                              <span
                                key={lot.inventoryId}
                                className={`inline-flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-2xl text-[10px] font-black border ${
                                  isExpired
                                    ? 'bg-red-50 text-red-600 border-red-100'
                                    : 'bg-green-50 text-green-600 border-green-100'
                                }`}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-green-500'}`} />
                                  {lot.lotNo}
                                </span>
                                <span className="text-[9px] font-semibold opacity-80">
                                  รับเข้า {formatReceivedDate(lot.receivedOn)}
                                </span>
                              </span>
                            );
                          })}
                          {item.lots.length > 4 && (
                            <span className="text-[10px] font-black text-gray-400 uppercase">
                              +{item.lots.length - 4} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-center">
                        <p className="text-lg font-black text-gray-900">
                          {item.quantity}{' '}
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{item.unit}</span>
                        </p>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight ${
                            isLow
                              ? 'bg-red-50 text-red-600 border border-red-100'
                              : 'bg-green-50 text-green-600 border border-green-100'
                          }`}
                        >
                          {isLow ? 'ต่ำกว่าจุดสั่งซื้อ' : 'พร้อมใช้งาน'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        data={reagents}
        jobTypes={jobTypes.filter((type) => type !== 'ทั้งหมด')}
      />

      <ReagentDetailModal
        key={selectedReagent?.itemId ?? 'empty'}
        isOpen={!!selectedReagent}
        onClose={() => setSelectedReagent(null)}
        reagent={selectedReagent}
        canReconcile={isPowerUser}
        onInventoryUpdated={async () => {
          setSelectedReagent(null);
          await fetchData();
        }}
      />
    </div>
  );
}
