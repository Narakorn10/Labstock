'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { apiClient, PurchaseOrderSummary, Reagent, Shipment } from '@/lib/api-client';
import { useAuth } from '@/components/auth-provider';

const ReportModal = dynamic(() => import('@/components/report-modal'), { ssr: false });
const ReagentDetailModal = dynamic(() => import('@/components/reagent-detail-modal'), { ssr: false });

type InventoryFilter = 'all' | 'low' | 'nearExpiry' | 'expired';

type TodayWorkItem = {
  id: InventoryFilter;
  title: string;
  detail: string;
  value: number;
  icon: typeof ShieldAlert;
  tone: 'critical' | 'warning' | 'neutral';
  href: string;
};


const JOB_HUES: Record<string, number> = { 'เคมีคลินิก': 250, 'โลหิตวิทยา': 25, 'ภูมิคุ้มกันวิทยา': 300, 'การแข็งตัวของเลือด': 70, 'จุลทรรศนศาสตร์คลินิก': 150 };

function jobTone(job?: string) {
  const name = job || '';
  let hue = JOB_HUES[name];
  if (hue === undefined) {
    hue = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
  }
  return { bg: `oklch(0.93 0.05 ${hue})`, fg: `oklch(0.45 0.14 ${hue})` };
}

function getReagentInfo(reagent: Reagent) {
  const now = new Date();
  const nearExpiryDate = new Date();
  nearExpiryDate.setDate(nearExpiryDate.getDate() + 30);
  const lots = [...reagent.lots].sort((a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime());
  const expired = lots.some((lot) => new Date(lot.expDate) < now);
  const near = lots.some((lot) => {
    const expiryDate = new Date(lot.expDate);
    return expiryDate >= now && expiryDate < nearExpiryDate;
  });
  const low = reagent.quantity <= reagent.minThreshold;
  const nextLot = lots.find((lot) => new Date(lot.expDate) >= now);

  let status = 'พร้อมใช้';
  let tagClass = 'bg-ok-bg text-ok';
  if (lots.length === 0) {
    status = 'หมดสต๊อก';
    tagClass = 'bg-crit text-white';
  } else if (expired) {
    status = 'มี lot หมดอายุ';
    tagClass = 'bg-crit-bg text-crit';
  } else if (low) {
    status = 'ต่ำกว่าจุดสั่งซื้อ';
    tagClass = 'bg-crit-bg text-crit';
  } else if (near) {
    status = 'ใกล้หมดอายุ';
    tagClass = 'bg-warn-bg text-warn';
  }

  return { low, nextLot, status, tagClass };
}

function daysUntil(expDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expDate.slice(0, 10)}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / 864e5);
}

export default function InventoryOverview() {
  const { user, loading: authLoading } = useAuth();
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Search handed over from the header (?q=... on arrival, or an event when already on this page).
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q');
    // Deferred so the state update is not synchronous inside the effect.
    const timer = initial ? window.setTimeout(() => setSearchTerm(initial), 0) : undefined;
    const onSearch = (event: Event) => setSearchTerm(String((event as CustomEvent<string>).detail ?? ''));
    window.addEventListener('labstock:search', onSearch);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('labstock:search', onSearch);
    };
  }, []);
  const [selectedJobType, setSelectedJobType] = useState<string>('ทั้งหมด');
  const [selectedReagentType, setSelectedReagentType] = useState<string>('ทั้งหมด');
  const [selectedReagent, setSelectedReagent] = useState<Reagent | null>(null);
  const [statusFilter, setStatusFilter] = useState<InventoryFilter>('all');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderSummary[]>([]);
  const [selectedWork, setSelectedWork] = useState<TodayWorkItem | null>(null);
  const closeWorkButtonRef = useRef<HTMLButtonElement>(null);
  const workTriggerRef = useRef<HTMLElement | null>(null);
  const workDialogRef = useRef<HTMLElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dashData = await apiClient.getDashboard();
      setReagents(dashData);
      if (user?.role === 'Admin' || user?.role === 'Manager') {
        const [shipmentResult, purchaseOrderResult] = await Promise.allSettled([
          apiClient.getShipments(),
          apiClient.getPurchaseOrders(),
        ]);
        if (shipmentResult.status === 'fulfilled') setShipments(shipmentResult.value);
        if (purchaseOrderResult.status === 'fulfilled') setPurchaseOrders(purchaseOrderResult.value);
      }
    } catch (err) {
      console.error('Inventory overview fetch error:', err);
      setError('ไม่สามารถโหลดข้อมูลภาพรวมคลังได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) {
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
      {
        name: 'Lot หมดอายุ',
        value: expired,
        icon: XCircle,
        color: 'text-[var(--clinical-critical)]',
        bg: 'bg-[#fff1f0]',
        filter: 'expired' as InventoryFilter,
        label: 'เร่งด่วน',
        detail: 'lot ที่เกินวันหมดอายุ',
        unit: 'lot',
      },
      {
        name: 'ต่ำกว่าจุดสั่งซื้อ',
        value: low,
        icon: AlertTriangle,
        color: 'text-[var(--clinical-warning)]',
        bg: 'bg-[#fff7e8]',
        filter: 'low' as InventoryFilter,
        label: 'ต้องสั่งซื้อ',
        detail: 'รายการต่ำกว่าระดับที่ตั้งไว้',
        unit: 'รายการ',
      },
      {
        name: 'ใกล้หมดอายุ',
        value: nearExpiry,
        icon: Clock,
        color: 'text-[var(--clinical-warning)]',
        bg: 'bg-[#fff7e8]',
        filter: 'nearExpiry' as InventoryFilter,
        label: 'ตรวจสอบล่วงหน้า',
        detail: 'lot ที่หมดอายุภายใน 30 วัน',
        unit: 'lot',
      },
      {
        name: 'รายการคงคลัง',
        value: reagents.length,
        icon: Package,
        color: 'text-clinical-700',
        bg: 'bg-gray-50',
        filter: 'all' as InventoryFilter,
        label: 'ภาพรวม',
        detail: 'รายการที่กำลังติดตามทั้งหมด',
        unit: 'รายการ',
      },
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
  const procurementSnapshot = useMemo(() => {
    const inTransit = shipments.filter((shipment) => shipment.status === 'In Transit').length;
    const received = shipments.filter((shipment) => shipment.status === 'Received').length;
    const pendingOrders = purchaseOrders.filter((order) => ['SUBMITTED', 'PENDING_LAB_REVIEW', 'CONFIRMED', 'PARTIALLY_SHIPPED'].includes(order.status)).length;
    return { inTransit, received, pendingOrders, recentShipments: shipments.slice(0, 3) };
  }, [purchaseOrders, shipments]);
  const activeQueue = stats.find((stat) => stat.filter === statusFilter);
  const todayWork = useMemo(() => {
    const expired = stats.find((stat) => stat.filter === 'expired')?.value ?? 0;
    const low = stats.find((stat) => stat.filter === 'low')?.value ?? 0;
    const nearExpiry = stats.find((stat) => stat.filter === 'nearExpiry')?.value ?? 0;

    return [
      {
        id: 'expired' as InventoryFilter,
        title: 'แยก lot ที่หมดอายุ',
        detail: 'ห้ามนำไปเบิกจ่าย และควรตรวจสอบการจัดเก็บ',
        value: expired,
        icon: ShieldAlert,
        tone: 'critical',
        href: '/master/inventory',
      },
      {
        id: 'low' as InventoryFilter,
        title: 'ตรวจรายการต่ำกว่าจุดสั่งซื้อ',
        detail: 'เตรียมข้อมูลสำหรับการสั่งซื้อหรือยืมสำรอง',
        value: low,
        icon: AlertTriangle,
        tone: 'warning',
        href: '/orders',
      },
      {
        id: 'nearExpiry' as InventoryFilter,
        title: 'ทบทวน lot ใกล้หมดอายุ',
        detail: 'วางแผนใช้ก่อนหมดอายุภายใน 30 วัน',
        value: nearExpiry,
        icon: Clock,
        tone: 'warning',
        href: '/master/inventory',
      },
      {
        id: 'all' as InventoryFilter,
        title: 'เตรียมรายการสำหรับตรวจนับ',
        detail: 'เปิดรายการคงคลังเพื่อเริ่มตรวจนับตามรอบ',
        value: reagents.length,
        icon: ClipboardCheck,
        tone: 'neutral',
        href: '/count',
      },
    ] satisfies TodayWorkItem[];
  }, [reagents.length, stats]);

  const workPreviewItems = useMemo(() => {
    if (!selectedWork || selectedWork.id === 'all') return [];

    const now = new Date();
    const nearExpiryDate = new Date();
    nearExpiryDate.setDate(nearExpiryDate.getDate() + 30);

    const candidates = selectedWork.id === 'low'
      ? reagents
        .filter((reagent) => reagent.quantity <= reagent.minThreshold)
        .flatMap((reagent) => reagent.lots.slice(0, 1).map((lot) => ({ reagent, lot })))
      : reagents.flatMap((reagent) => reagent.lots.map((lot) => ({ reagent, lot })));

    return candidates
      .filter(({ reagent, lot }) => {
        const expiryDate = new Date(lot.expDate);
        if (selectedWork.id === 'low') return reagent.quantity <= reagent.minThreshold;
        if (selectedWork.id === 'expired') return expiryDate < now;
        return expiryDate >= now && expiryDate < nearExpiryDate;
      })
      .sort((a, b) => new Date(a.lot.expDate).getTime() - new Date(b.lot.expDate).getTime())
      .slice(0, 5);
  }, [reagents, selectedWork]);

  useEffect(() => {
    if (!selectedWork) return;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeWorkButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedWork(null);
      if (event.key !== 'Tab' || !workDialogRef.current) return;

      const focusable = Array.from(workDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [selectedWork]);

  useEffect(() => {
    if (selectedWork || !workTriggerRef.current) return;
    workTriggerRef.current.focus();
    workTriggerRef.current = null;
  }, [selectedWork]);

  const inventoryAtRisk = useMemo(() => {
    const now = new Date();
    const nearExpiryDate = new Date();
    nearExpiryDate.setDate(nearExpiryDate.getDate() + 30);

    return reagents
      .flatMap((reagent) => reagent.lots.map((lot) => ({ reagent, lot })))
      .filter(({ reagent, lot }) => {
        const expiryDate = new Date(lot.expDate);
        return reagent.quantity <= reagent.minThreshold || expiryDate < nearExpiryDate;
      })
      .sort((a, b) => new Date(a.lot.expDate).getTime() - new Date(b.lot.expDate).getTime())
      .slice(0, 6)
      .map(({ reagent, lot }) => ({
        reagent,
        lot,
        expired: new Date(lot.expDate) < now,
        nearExpiry: new Date(lot.expDate) >= now && new Date(lot.expDate) < nearExpiryDate,
        low: reagent.quantity <= reagent.minThreshold,
        days: daysUntil(lot.expDate),
      }));
  }, [reagents]);
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
        <Loader2 className="animate-spin text-blue-700" size={42} />
        <p className="text-gray-600 animate-pulse font-medium text-sm">
          กำลังโหลดข้อมูลคลังน้ำยา
        </p>
      </div>
    );
  }

  const workName = user?.role === 'Vendor' && user.vendor ? user.vendor : 'กลุ่มงานเทคนิคการแพทย์และพยาธิวิทยาคลินิก';
  const todayLabel = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <section aria-labelledby="inventory-dashboard-title" className="dashboard-hero relative overflow-hidden rounded-[20px] bg-ink text-white">
        <Image src="/images/labstock-clinical-inventory-hero.png" alt="" fill priority sizes="(max-width: 1024px) 100vw, 1100px" className="object-cover object-[right_40%]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,22,34,0.9)_0%,rgba(10,22,34,0.6)_50%,rgba(10,22,34,0.05)_100%)]" />
        <div className="relative flex min-h-[220px] flex-wrap items-end gap-4 px-8 pb-7 pt-8">
          <div className="mr-auto max-w-[560px]">
            <p className="mb-2.5 text-xs tracking-[0.16em] text-blue-300">LIVE LAB OPERATIONS</p>
            <h1 id="inventory-dashboard-title" className="text-[36px] font-medium leading-[1.2] tracking-[-0.02em] text-white text-pretty">
              คลังน้ำยาและวัสดุของ {workName}
            </h1>
            <p className="mt-2 text-[15px] text-gray-300">คลังน้ำยา ที่พร้อมให้ทีมแล็บตัดสินใจได้ทันเวลา</p>
          </div>
          <div className="flex flex-wrap items-center gap-4" role="group" aria-label="การดำเนินการภาพรวมคลัง">
            <span className="inline-flex cursor-default items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink">
              <CalendarDays size={16} aria-hidden="true" />
              {todayLabel}
            </span>
            <button type="button" onClick={fetchData} className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              อัปเดตข้อมูล
            </button>
            <button type="button" onClick={() => setReportModalOpen(true)} className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-4 py-[9px] text-sm font-medium text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <FileText size={16} aria-hidden="true" />
              รายงานประจำวัน
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl bg-crit-bg px-4 py-3 text-crit">
          <AlertTriangle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <section aria-label="คิวที่ต้องดำเนินการ" className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {stats.map((stat) => {
          const active = statusFilter === stat.filter;
          const footTone = stat.filter === 'all'
            ? 'text-gray-600'
            : stat.value > 0
              ? stat.filter === 'nearExpiry' ? 'text-warn' : 'text-crit'
              : 'text-ok';

          return (
            <button
              key={stat.name}
              type="button"
              onClick={() => setStatusFilter((current) => current === stat.filter ? 'all' : stat.filter)}
              aria-label={`${stat.name}: ${stat.value} ${stat.unit}. เลือกเพื่อเปิดคิวรายการ`}
              aria-pressed={active}
              className={`cursor-pointer rounded-[18px] border border-line bg-[#fafafa] p-1.5 text-left outline-2 outline-offset-2 transition-colors hover:border-gray-400 focus-visible:outline-ink ${active ? 'outline-ink' : 'outline-transparent'}`}
            >
              <span className="block rounded-[13px] border border-line bg-white px-4 py-3.5">
                <span className="flex items-center gap-2.5">
                  <span className={`grid size-[30px] place-items-center rounded-lg border border-line ${footTone}`} aria-hidden="true">
                    <stat.icon size={16} strokeWidth={1.5} />
                  </span>
                  <span className="text-[15px] text-gray-600">{stat.name}</span>
                </span>
                <span className="mt-2.5 block text-[40px] font-medium leading-[1.1] tracking-[-0.02em]">
                  {stat.value} <span className="text-sm font-normal text-gray-600">{stat.unit}</span>
                </span>
              </span>
              <span className={`flex items-center gap-1.5 px-2.5 pb-1.5 pt-[9px] text-[13px] ${footTone}`}>
                <span className="size-3 shrink-0 rounded-full border-[1.5px] border-dashed border-current opacity-60" aria-hidden="true" />
                {stat.label} · {stat.detail}
              </span>
            </button>
          );
        })}
      </section>

      <section aria-labelledby="inventory-list-heading" className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <h2 id="inventory-list-heading" className="mr-auto text-xl font-medium">
            {statusFilter === 'all' ? 'รายการคงคลังปัจจุบัน' : `คิว: ${activeQueue?.name}`}{' '}
            <span className="font-normal text-gray-600" aria-live="polite">{filteredItems.length.toLocaleString('th-TH')}</span>
          </h2>
          {searchTerm.trim() !== '' && (
            <button type="button" onClick={() => setSearchTerm('')} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[13px] text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
              ค้นหา: {searchTerm.trim()} <X size={14} aria-hidden="true" /><span className="sr-only">ล้างคำค้นหา</span>
            </button>
          )}
          {statusFilter !== 'all' && (
            <button type="button" onClick={() => setStatusFilter('all')} className="inline-flex items-center gap-2 rounded-[10px] border border-transparent px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
              ล้างคิว <X size={14} aria-hidden="true" />
            </button>
          )}
          <select
            aria-label="งาน"
            value={selectedJobType}
            onChange={(event) => setSelectedJobType(event.target.value)}
            className="min-h-[38px] min-w-[170px] cursor-pointer rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          >
            {jobTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            aria-label="ประเภท"
            value={selectedReagentType}
            onChange={(event) => setSelectedReagentType(event.target.value)}
            className="min-h-[38px] min-w-[150px] cursor-pointer rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          >
            {reagentTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div role="region" aria-label="ตารางรายการคงคลัง" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left">
            <caption className="sr-only">รายการคงคลังตามคิวและตัวกรองที่เลือก</caption>
            <thead>
              <tr>
                <th scope="col" className="rounded-l-[10px] bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">รายการ / รหัส</th>
                <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">งาน / ประเภท</th>
                <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">Lot ที่พร้อมใช้</th>
                <th scope="col" className="bg-ground px-3.5 py-2.5 text-right text-[13px] font-medium text-gray-600">คงเหลือ</th>
                <th scope="col" className="bg-ground px-3.5 py-2.5 text-[13px] font-medium text-gray-600">สถานะ</th>
                <th scope="col" className="rounded-r-[10px] bg-ground px-3.5 py-2.5 text-right text-[13px] font-medium text-gray-600">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const info = getReagentInfo(item);
                const tone = jobTone(item.jobType);
                const cell = 'border-b border-line px-3.5 py-3 align-middle text-sm';

                return (
                  <tr key={item.itemId} onClick={() => setSelectedReagent(item)} className="cursor-pointer transition-colors hover:bg-[#fafafa]">
                    <td className={cell}>
                      <div className="flex items-center gap-3">
                        <span className="grid size-[30px] shrink-0 place-items-center rounded-lg text-[11px] font-semibold" style={{ background: tone.bg, color: tone.fg }} aria-hidden="true">{item.itemId.slice(0, 2)}</span>
                        <div className="min-w-0">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-gray-600">{item.itemId}</div>
                        </div>
                      </div>
                    </td>
                    <td className={cell}>
                      <div>{item.jobType || '-'}</div>
                      <div className="text-xs text-gray-600">{item.reagentType || '-'}</div>
                    </td>
                    <td className={cell}>
                      <div>{item.lots.length ? `${item.lots.length} lot` : '—'}</div>
                      <div className="text-xs text-gray-600">{info.nextLot ? `ถัดไป ${formatReceivedDate(info.nextLot.expDate)}` : 'ไม่มี lot พร้อมใช้'}</div>
                    </td>
                    <td className={`${cell} text-right`}>
                      <span className={`font-semibold ${info.low ? 'text-crit' : ''}`}>{item.quantity}</span>{' '}
                      <span className="text-xs text-gray-600">{item.unit} · min {item.minThreshold}</span>
                    </td>
                    <td className={cell}>
                      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${info.tagClass}`}>{info.status}</span>
                    </td>
                    <td className={`${cell} text-right`}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedReagent(item);
                        }}
                        aria-label={`ดูรายละเอียด ${item.name}`}
                        className="rounded-md px-1.5 py-0.5 text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        ดู
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredItems.length === 0 && (
          <div className="px-3.5 py-10 text-left">
            <p className="text-lg font-medium">ไม่พบรายการที่ตรงกับตัวกรอง</p>
            <p className="mb-3.5 mt-1 text-sm text-gray-600">ลองล้างคำค้นหา หรือเปลี่ยนประเภทงาน / ประเภทน้ำยา</p>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedJobType('ทั้งหมด');
                setSelectedReagentType('ทั้งหมด');
                setStatusFilter('all');
              }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
            >
              <RefreshCw size={16} aria-hidden="true" />
              ล้างตัวกรองทั้งหมด
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="inventory-risk-heading" className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-3.5 flex items-center">
          <h2 id="inventory-risk-heading" className="mr-auto text-xl font-medium">ล็อตที่ต้องเฝ้าระวัง</h2>
          <button type="button" onClick={() => setStatusFilter('all')} className="text-sm text-ink underline hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
            ดูทั้งหมด
          </button>
        </div>
        {inventoryAtRisk.length === 0 ? (
          <p className="rounded-[10px] bg-[#fafafa] p-4 text-sm text-gray-600">ยังไม่พบ lot ที่ต่ำกว่าจุดสั่งซื้อหรือใกล้หมดอายุ</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
            {inventoryAtRisk.map(({ reagent, lot, expired, nearExpiry, days }) => (
              <button
                key={lot.inventoryId}
                type="button"
                onClick={() => setSelectedReagent(reagent)}
                className="cursor-pointer rounded-[14px] border border-line p-1.5 text-left transition-colors hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              >
                <span className="relative block min-h-[84px] rounded-[10px] bg-[#f6f6f7] p-3.5">
                  <span className={`absolute right-2.5 top-2.5 inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-medium ${expired ? 'bg-crit text-white' : nearExpiry ? 'bg-warn-bg text-warn' : 'bg-crit-bg text-crit'}`}>
                    {expired ? 'หมดอายุ' : nearExpiry ? `ใกล้หมดอายุ · ${days} วัน` : 'ต่ำกว่าจุดสั่งซื้อ'}
                  </span>
                  <span className="mt-[22px] block text-[34px] font-medium leading-none tracking-[-0.02em]">
                    {expired ? 'หมดอายุ' : nearExpiry ? days : reagent.quantity}
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {expired ? (days < 0 ? `เกินมา ${-days} วัน` : 'หมดอายุวันนี้') : nearExpiry ? 'วันก่อนหมดอายุ' : `${reagent.unit} · min ${reagent.minThreshold}`}
                  </span>
                </span>
                <span className="block px-2 pb-1.5 pt-2.5">
                  <span className="block font-medium">{reagent.name}</span>
                  <span className="block text-[13px] text-gray-600">Lot {lot.lotNo} · หมดอายุ {formatReceivedDate(lot.expDate)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="today-work-heading" className="rounded-2xl border border-line bg-white p-5">
        <h2 id="today-work-heading" className="mb-2 text-xl font-medium">งานที่ควรจัดการก่อน</h2>
        {todayWork.map((work) => {
          const Icon = work.icon;
          const tone = work.id === 'expired' && work.value > 0 ? 'bg-crit-bg text-crit' : 'bg-gray-200 text-ink';
          const rowClass = 'group flex w-full items-center gap-3.5 rounded-[10px] px-2.5 py-3 text-left transition-colors hover:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400';
          const body = (
            <>
              <span className={`grid size-[38px] shrink-0 place-items-center rounded-[10px] ${tone}`} aria-hidden="true">
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <span className={`inline-flex min-w-7 items-center justify-center rounded-full px-2.5 py-[3px] text-xs font-semibold ${tone}`}>{work.value}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{work.title}</span>
                <span className="block text-[13px] text-gray-600">{work.detail}</span>
              </span>
              <span className="text-[13px] text-gray-700">{work.id === 'all' ? 'ไปหน้าตรวจนับ' : 'เปิดคิว'} →</span>
            </>
          );

          return work.id === 'all' ? (
            <Link key={work.title} href={work.href} aria-label={`${work.title}. เปิดหน้างานจริง`} className={`${rowClass} text-ink!`}>
              {body}
            </Link>
          ) : (
            <button
              key={work.title}
              type="button"
              onClick={(event) => {
                workTriggerRef.current = event.currentTarget;
                setSelectedWork(work);
              }}
              aria-label={`${work.title}. ดูตัวอย่างรายการก่อนเปิดหน้างานจริง`}
              className={rowClass}
            >
              {body}
            </button>
          );
        })}
      </section>

      {selectedWork && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedWork(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="today-work-dialog-title"
            ref={workDialogRef}
            className="w-full max-w-lg rounded-2xl border border-clinical-border bg-white p-5 shadow-2xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-clinical-700">TODAY&apos;S WORK PREVIEW</p>
                <h2 id="today-work-dialog-title" className="mt-1 text-xl font-semibold text-clinical-900">{selectedWork.title}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--clinical-muted)]">{selectedWork.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWork(null)}
                ref={closeWorkButtonRef}
                aria-label="ปิดตัวอย่างงาน"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 rounded-lg border border-gray-300 bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-600">รายการตัวอย่าง ({selectedWork.value.toLocaleString('th-TH')} รายการทั้งหมด)</p>
              {workPreviewItems.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--clinical-muted)]">ไม่พบรายการที่ต้องแสดงในขณะนี้</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-300">
                  {workPreviewItems.map(({ reagent, lot }) => (
                    <li key={lot.inventoryId} className="py-1 first:pt-0 last:pb-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWork(null);
                          setSelectedReagent(reagent);
                        }}
                        className="flex min-h-14 w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                        aria-label={`เปิดรายละเอียด ${reagent.name} lot ${lot.lotNo}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-clinical-900">{reagent.name}</span>
                          <span className="mt-0.5 block text-xs text-[var(--clinical-muted)]">Lot {lot.lotNo} · หมดอายุ {formatReceivedDate(lot.expDate)}</span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-clinical-700">คงเหลือ {reagent.quantity} {reagent.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSelectedWork(null)}
                className="min-h-11 rounded-lg border border-clinical-border px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
              >
                ปิด
              </button>
              <Link
                href={selectedWork.href}
                onClick={() => setSelectedWork(null)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-semibold !text-white hover:bg-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
              >
                ไปหน้าจัดการจริง
              </Link>
            </div>
          </section>
        </div>
      )}

      {isPowerUser && (
        <section aria-labelledby="procurement-pulse-heading" className="rounded-xl border border-clinical-border bg-white p-5 shadow-[0_14px_36px_-30px_rgba(18,59,58,0.7)] md:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-clinical-700">PROCUREMENT PULSE</p>
              <h2 id="procurement-pulse-heading" className="mt-1 text-lg font-semibold text-clinical-900">Purchase orders &amp; shipments</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--clinical-muted)]">Read-only operational signals from the existing procurement workflows.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/orders"
                className="inline-flex min-h-11 items-center rounded-lg border border-clinical-border px-3 text-xs font-semibold text-clinical-700 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
              >
                View purchase orders
              </Link>
              <Link
                href="/orders/tracking"
                className="inline-flex min-h-11 items-center rounded-lg bg-gray-900 px-3 text-xs font-semibold !text-white transition-colors hover:bg-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
              >
                Track shipments
              </Link>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: 'Pending purchase orders', value: procurementSnapshot.pendingOrders, icon: ShoppingCart, tone: 'text-clinical-700 bg-gray-50' },
              { label: 'Shipments in transit', value: procurementSnapshot.inTransit, icon: Truck, tone: 'text-blue-700 bg-gray-50' },
              { label: 'Received shipments', value: procurementSnapshot.received, icon: ClipboardCheck, tone: 'text-[#2f7d3c] bg-[#edf8ef]' },
            ].map((metric) => (
              <div key={metric.label} className="flex items-center gap-3 rounded-lg border border-gray-300 bg-gray-50 p-4">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${metric.tone}`} aria-hidden="true">
                  <metric.icon size={19} strokeWidth={1.8} />
                </span>
                <span>
                  <span className="block text-2xl font-semibold tracking-tight text-clinical-900">{metric.value}</span>
                  <span className="block text-xs text-[var(--clinical-muted)]">{metric.label}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-gray-300">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">Recent shipment status</caption>
              <thead className="bg-[#f7faf8] text-xs font-semibold text-gray-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Reference</th>
                  <th scope="col" className="px-4 py-3">Vendor</th>
                  <th scope="col" className="px-4 py-3">Reagent</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300">
                {procurementSnapshot.recentShipments.map((shipment) => (
                  <tr key={shipment.id}>
                    <td className="px-4 py-3 font-semibold text-clinical-900">{shipment.reference_no}</td>
                    <td className="px-4 py-3 text-gray-600">{shipment.vendor}</td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-gray-600">{shipment.reagent_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${shipment.status === 'In Transit' ? 'bg-gray-50 text-blue-700' : shipment.status === 'Received' ? 'bg-[#edf8ef] text-[#2f7d3c]' : 'bg-[#fff1f0] text-[var(--clinical-critical)]'}`}>
                        {shipment.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {procurementSnapshot.recentShipments.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-5 text-center text-xs text-[var(--clinical-muted)]">No shipment activity available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {reportModalOpen && (
        <ReportModal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          data={reagents}
          jobTypes={jobTypes.filter((type) => type !== 'ทั้งหมด')}
        />
      )}

      {selectedReagent && (
        <ReagentDetailModal
          key={selectedReagent.itemId}
          isOpen
          onClose={() => setSelectedReagent(null)}
          reagent={selectedReagent}
          canReconcile={isPowerUser}
          onInventoryUpdated={async () => {
            setSelectedReagent(null);
            await fetchData();
          }}
        />
      )}
    </div>
  );
}
