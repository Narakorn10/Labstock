'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  Search,
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

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-3 duration-500 lg:space-y-7">
      <section aria-labelledby="inventory-dashboard-title" className="dashboard-hero overflow-hidden rounded-[1.75rem] border border-gray-300 bg-gray-950 text-white shadow-[0_24px_60px_-38px_rgba(10,47,58,0.85)]">
        <div className="relative grid min-h-[280px] items-stretch lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative z-10 flex flex-col justify-between p-6 sm:p-8 lg:p-10">
            <div>
              <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold tracking-[0.16em] text-gray-300">
                <span className="size-2 rounded-full bg-blue-300 shadow-[0_0_0_5px_rgba(94,234,212,0.12)]" aria-hidden="true" />
                LIVE LAB OPERATIONS
              </div>
              <h1 id="inventory-dashboard-title" className="max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                คลังน้ำยา ที่พร้อมให้ทีมแล็บตัดสินใจได้ทันเวลา
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-gray-300 sm:text-base">
                สรุปสัญญาณสำคัญของปริมาณคงเหลือ การสั่งซื้อ และอายุ lot ในมุมมองเดียว เพื่อช่วยจัดลำดับงานอย่างมั่นใจ
              </p>
            </div>
            <div className="mt-7 flex flex-wrap gap-3" role="group" aria-label="การดำเนินการภาพรวมคลัง">
              <button type="button" onClick={fetchData} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                อัปเดตข้อมูล
              </button>
              <button type="button" onClick={() => setReportModalOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#e8c77b] px-4 text-sm font-semibold text-gray-900 transition hover:bg-[#f6db9a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <FileText size={16} />
                รายงานประจำวัน
              </button>
            </div>
          </div>
          <div className="relative min-h-[220px] overflow-hidden lg:min-h-full">
            <Image src="/images/labstock-clinical-inventory-hero.png" alt="พื้นที่จัดเก็บน้ำยาและอุปกรณ์ห้องปฏิบัติการที่เป็นระเบียบ" fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover object-right" />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/15 to-transparent lg:bg-gradient-to-r lg:from-gray-950 lg:via-transparent lg:to-transparent" />
            <div className="absolute bottom-5 right-5 rounded-2xl border border-white/20 bg-gray-950/85 px-4 py-3 text-right shadow-lg backdrop-blur-md">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-gray-300">TODAY&apos;S FOCUS</p>
              <p className="mt-1 text-sm font-semibold text-white">ตรวจสต็อกก่อนเริ่มงาน</p>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-[#f3c6c2] bg-[#fff1f0] p-4 text-[var(--clinical-critical)]">
          <AlertTriangle size={20} />
          <p className="text-xs font-bold">{error}</p>
        </div>
      )}

      <section aria-labelledby="priority-queues-heading" className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-clinical-700">PRIORITY QUEUES</p>
            <h2 id="priority-queues-heading" className="mt-1 text-lg font-semibold text-clinical-900">คิวที่ต้องดำเนินการ</h2>
          </div>
          <p className="text-xs leading-5 text-[var(--clinical-muted)]">เลือกคิวเพื่อกรองรายการด้านล่าง</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <button
              key={stat.name}
              type="button"
              onClick={() => setStatusFilter((current) => current === stat.filter ? 'all' : stat.filter)}
              aria-label={`${stat.name}: ${stat.value} ${stat.unit}. เลือกเพื่อเปิดคิวรายการ`}
              aria-pressed={statusFilter === stat.filter}
              className={`group min-h-40 rounded-xl border bg-white p-5 text-left shadow-[0_12px_30px_-28px_rgba(18,59,58,0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-[0_16px_34px_-28px_rgba(18,59,58,0.85)] active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700 ${statusFilter === stat.filter ? 'border-clinical-700 bg-gray-50 ring-2 ring-gray-400/15' : 'border-clinical-border'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className={`flex size-11 items-center justify-center rounded-lg ${stat.bg} ${stat.color}`}>
                  <stat.icon size={21} strokeWidth={1.8} />
                </div>
                <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gray-600">{stat.label}</span>
              </div>
              <p className="mt-4 text-xs font-medium text-[var(--clinical-muted)]">{stat.name}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-3xl font-semibold tracking-tight text-clinical-900">{stat.value}</p>
                <span className="text-xs font-medium text-[var(--clinical-muted)]">{stat.unit}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-600">{stat.detail}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
        <section aria-labelledby="today-work-heading" className="rounded-xl border border-clinical-border bg-white p-5 shadow-[0_14px_36px_-30px_rgba(18,59,58,0.7)] md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-clinical-700">TODAY&apos;S WORK</p>
              <h2 id="today-work-heading" className="mt-1 text-lg font-semibold text-clinical-900">งานที่ควรจัดการก่อน</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--clinical-muted)]">กดแต่ละรายการเพื่อเปิดคิวจากข้อมูลคลังปัจจุบัน</p>
            </div>
          </div>

          <div className="mt-4 divide-y divide-gray-300">
            {todayWork.map((work) => {
              const Icon = work.icon;
              const toneClass = work.tone === 'critical'
                ? 'bg-[#fff1f0] text-[var(--clinical-critical)]'
                : work.tone === 'warning'
                  ? 'bg-[#fff7e8] text-[var(--clinical-warning)]'
                  : 'bg-gray-50 text-clinical-700';

              return work.id === 'all' ? (
                <Link
                  key={work.title}
                  href={work.href}
                  aria-label={`${work.title}. เปิดหน้างานจริง`}
                  className="group flex min-h-16 w-full items-center gap-3 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${toneClass}`} aria-hidden="true">
                    <Icon size={19} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-clinical-900">{work.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-[var(--clinical-muted)]">{work.detail}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-clinical-700">
                    <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600">{work.value}</span>
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
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
                  className="group flex min-h-16 w-full items-center gap-3 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${toneClass}`} aria-hidden="true">
                    <Icon size={19} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-clinical-900">{work.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-[var(--clinical-muted)]">{work.detail}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-clinical-700">
                    <span className="rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-600">{work.value}</span>
                    <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </button>
                );
            })}
          </div>
        </section>

        <section aria-labelledby="inventory-risk-heading" className="rounded-xl border border-clinical-border bg-white p-5 shadow-[0_14px_36px_-30px_rgba(18,59,58,0.7)] md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-clinical-700">INVENTORY AT RISK</p>
              <h2 id="inventory-risk-heading" className="mt-1 text-lg font-semibold text-clinical-900">ล็อตที่ต้องเฝ้าระวัง</h2>
            </div>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="shrink-0 text-xs font-semibold text-clinical-700 underline underline-offset-2 hover:text-clinical-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
            >
              ดูทั้งหมด
            </button>
          </div>

          {inventoryAtRisk.length === 0 ? (
            <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm leading-6 text-[var(--clinical-muted)]">ยังไม่พบ lot ที่ต่ำกว่าจุดสั่งซื้อหรือใกล้หมดอายุ</p>
          ) : (
            <div className="mt-4 divide-y divide-gray-300">
              {inventoryAtRisk.map(({ reagent, lot, expired, nearExpiry, low }) => (
                <button
                  key={lot.inventoryId}
                  type="button"
                  onClick={() => setSelectedReagent(reagent)}
                  className="w-full py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-clinical-900">{reagent.name}</span>
                      <span className="mt-1 block text-xs text-[var(--clinical-muted)]">Lot {lot.lotNo} · หมดอายุ {formatReceivedDate(lot.expDate)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${expired ? 'bg-[#fff1f0] text-[var(--clinical-critical)]' : nearExpiry ? 'bg-[#fff7e8] text-[var(--clinical-warning)]' : 'bg-gray-50 text-clinical-700'}`}>
                      {expired ? 'หมดอายุ' : nearExpiry ? 'ใกล้หมดอายุ' : low ? 'ต่ำกว่าจุดสั่งซื้อ' : 'ติดตาม'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

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

      <div className="flex flex-col overflow-hidden rounded-xl border border-clinical-border bg-white shadow-[0_14px_36px_-30px_rgba(18,59,58,0.7)]">
        <div className="space-y-4 border-b border-gray-300 p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 rounded-full bg-clinical-700" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold tracking-[0.1em] text-clinical-700">WORKLIST</p>
                <h2 className="mt-1 text-lg font-semibold text-clinical-900">
                  {statusFilter === 'all' ? 'รายการคงคลังปัจจุบัน' : `คิว: ${activeQueue?.name}`}
                </h2>
                <p aria-live="polite" className="mt-1 text-xs text-[var(--clinical-muted)]">
                  พบ {filteredItems.length.toLocaleString('th-TH')} {statusFilter === 'expired' || statusFilter === 'nearExpiry' ? 'รายการที่มี lot ตรงเงื่อนไข' : 'รายการตามตัวกรอง'}
                </p>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="mt-1 text-xs font-medium text-clinical-700 underline underline-offset-2 hover:text-clinical-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
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
                aria-label="ค้นหาชื่อน้ำยา หรือรหัสรายการ"
                className="w-full rounded-lg border border-transparent bg-gray-50 py-3 pl-11 pr-4 text-sm font-medium text-clinical-900 transition-all focus:border-gray-400 focus:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <section aria-label="ตัวกรองรายการคงคลัง" className="space-y-3 rounded-lg border border-clinical-border bg-[#f7faf8] p-3 md:p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-gray-600">กรองรายการ</p>
              {(selectedJobType !== 'ทั้งหมด' || selectedReagentType !== 'ทั้งหมด') && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJobType('ทั้งหมด');
                    setSelectedReagentType('ทั้งหมด');
                  }}
                  className="shrink-0 text-xs font-medium text-clinical-700 underline underline-offset-2 hover:text-clinical-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <div className="space-y-1.5">
                <label htmlFor="job-filter" className="text-xs font-medium text-gray-600">
                  งาน
                </label>
                <select
                  id="job-filter"
                  value={selectedJobType}
                  onChange={(event) => setSelectedJobType(event.target.value)}
                  className="h-11 w-full cursor-pointer rounded-lg border border-clinical-border bg-white px-3 text-sm font-medium text-clinical-900 shadow-sm transition-colors hover:border-gray-400 focus:border-clinical-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  {jobTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="reagent-type-filter" className="text-xs font-medium text-gray-600">
                  ประเภท
                </label>
                <select
                  id="reagent-type-filter"
                  value={selectedReagentType}
                  onChange={(event) => setSelectedReagentType(event.target.value)}
                  className="h-11 w-full cursor-pointer rounded-lg border border-clinical-border bg-white px-3 text-sm font-medium text-clinical-900 shadow-sm transition-colors hover:border-gray-400 focus:border-clinical-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinical-700"
                >
                  {reagentTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>

        <div role="region" aria-label="ตารางรายการคงคลัง" tabIndex={0} className="no-scrollbar max-h-[680px] flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-clinical-700">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <caption className="sr-only">รายการคงคลังตามคิวและตัวกรองที่เลือก</caption>
            <thead>
              <tr className="bg-gray-50 sticky top-0 z-10 border-b border-gray-300">
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-gray-600 tracking-wide">รายการ / รหัส</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-gray-600 tracking-wide">งาน / ประเภท</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-gray-600 tracking-wide">Lot ที่พร้อมใช้</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-gray-600 tracking-wide text-center">คงเหลือ</th>
                <th className="px-6 md:px-8 py-4 text-xs font-semibold text-gray-600 tracking-wide text-right">สถานะ</th>
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
                      className="hover:bg-gray-50 transition-colors group cursor-pointer"
                    >
                      <td className="px-6 md:px-8 py-5">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors line-clamp-1">
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
