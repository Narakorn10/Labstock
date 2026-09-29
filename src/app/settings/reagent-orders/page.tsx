'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Lock, RefreshCw, Save, Search, X } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';

const VERIFICATION_STATUSES = [
  { value: 'VERIFIED', label: 'ตรวจสอบต้นฉบับแล้ว' },
  { value: 'NEEDS_REVIEW', label: 'ต้องทบทวน' },
  { value: 'NOT_AVAILABLE', label: 'ไม่มีต้นฉบับ' },
] as const;

type SourceVerificationStatus = (typeof VERIFICATION_STATUSES)[number]['value'];
type NumericValue = number | string | null | undefined;

type ReagentOrderPolicy = {
  item_id: string;
  name: string;
  barcode?: string | null;
  unit?: string | null;
  vendor?: string | null;
  reagent_type?: string | null;
  machine_type?: string | null;
  tests_per_box: NumericValue;
  avg_patient_tests_per_month: NumericValue;
  iqc_tests_per_month: NumericValue;
  documented_actual_withdrawal_boxes: NumericValue;
  source_verification_status: SourceVerificationStatus | null;
  approved_monthly_target_boxes: NumericValue;
  approved_order_qty_boxes: NumericValue;
  orders_per_month: NumericValue;
  lead_time_days: NumericValue;
  safety_stock_boxes: NumericValue;
  min_order_qty_boxes: NumericValue;
  order_multiple_boxes: NumericValue;
  review_days: NumericValue;
  enabled: boolean;
  policy_configured?: boolean;
  reason: string | null;
  revision: NumericValue;
  theoretical_monthly_boxes?: NumericValue;
  approved_monthly_from_cycle_boxes?: NumericValue;
  updated_at?: string | null;
  updated_by?: string | null;
};

type PolicyForm = {
  item_id: string;
  expected_revision: number;
  tests_per_box: string;
  avg_patient_tests_per_month: string;
  iqc_tests_per_month: string;
  documented_actual_withdrawal_boxes: string;
  source_verification_status: SourceVerificationStatus;
  approved_monthly_target_boxes: string;
  approved_order_qty_boxes: string;
  orders_per_month: string;
  lead_time_days: string;
  safety_stock_boxes: string;
  min_order_qty_boxes: string;
  order_multiple_boxes: string;
  review_days: string;
  enabled: boolean;
  reason: string;
  change_reason: string;
};

function numeric(value: NumericValue, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function inputValue(value: NumericValue) {
  return value === null || value === undefined ? '' : String(value);
}

function makeForm(policy: ReagentOrderPolicy): PolicyForm {
  return {
    item_id: policy.item_id,
    expected_revision: numeric(policy.revision),
    tests_per_box: inputValue(policy.tests_per_box),
    avg_patient_tests_per_month: inputValue(policy.avg_patient_tests_per_month),
    iqc_tests_per_month: inputValue(policy.iqc_tests_per_month),
    documented_actual_withdrawal_boxes: inputValue(policy.documented_actual_withdrawal_boxes),
    source_verification_status: policy.source_verification_status || 'NEEDS_REVIEW',
    approved_monthly_target_boxes: inputValue(policy.approved_monthly_target_boxes),
    approved_order_qty_boxes: inputValue(policy.approved_order_qty_boxes),
    orders_per_month: inputValue(policy.orders_per_month),
    lead_time_days: inputValue(policy.lead_time_days),
    safety_stock_boxes: inputValue(policy.safety_stock_boxes),
    min_order_qty_boxes: inputValue(policy.min_order_qty_boxes),
    order_multiple_boxes: inputValue(policy.order_multiple_boxes),
    review_days: inputValue(policy.review_days || 15),
    enabled: policy.policy_configured ? Boolean(policy.enabled) : false,
    reason: policy.reason || '',
    change_reason: '',
  };
}

function toPayloadNumber(value: string, nullable = false) {
  if (!value.trim() && nullable) return null;
  return Number(value);
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  optional = false,
  integer = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  optional?: boolean;
  integer?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-700">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={integer ? 0 : undefined}
        step={integer ? '1' : 'any'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={optional ? 'เว้นว่างได้' : '0'}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-400/15"
      />
      {hint && <span className="mt-1 block text-[11px] leading-4 text-slate-500">{hint}</span>}
    </label>
  );
}

export default function ReagentOrderPoliciesPage() {
  const { user, loading: authLoading } = useAuth();
  const [policies, setPolicies] = useState<ReagentOrderPolicy[]>([]);
  const [selected, setSelected] = useState<ReagentOrderPolicy | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const choosePolicy = (policy: ReagentOrderPolicy) => {
    setSelected(policy);
    setForm(makeForm(policy));
    setError(null);
    setNotice(null);
  };

  const loadPolicies = async (query = search, selectItemId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('labstock_token');
      const response = await fetch(`/api/settings/reagent-orders?q=${encodeURIComponent(query)}&limit=300`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const payload = await response.json() as { data?: ReagentOrderPolicy[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'ไม่สามารถโหลดนโยบายการสั่งซื้อได้');

      const nextPolicies = payload.data || [];
      setPolicies(nextPolicies);
      const nextSelected = selectItemId
        ? nextPolicies.find((policy) => policy.item_id === selectItemId)
        : nextPolicies.find((policy) => policy.item_id === selected?.item_id) || nextPolicies[0];
      if (nextSelected) {
        setSelected(nextSelected);
        setForm(makeForm(nextSelected));
      } else {
        setSelected(null);
        setForm(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ไม่สามารถโหลดนโยบายการสั่งซื้อได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && (user?.role === 'Admin' || user?.role === 'Manager')) {
      // The auth provider is the external system being synchronized here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadPolicies('');
    }
    // Only run after the authentication state settles; search is applied explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.role]);

  const theoreticalMonthlyBoxes = useMemo(() => {
    if (!form) return null;
    const testsPerBox = Number(form.tests_per_box);
    if (!Number.isFinite(testsPerBox) || testsPerBox <= 0) return null;
    return Math.round((numeric(form.avg_patient_tests_per_month) + numeric(form.iqc_tests_per_month)) / testsPerBox);
  }, [form]);

  const approvedMonthlyFromCycle = useMemo(() => {
    if (!form || !form.approved_order_qty_boxes.trim()) return null;
    const result = Number(form.approved_order_qty_boxes) * Number(form.orders_per_month);
    return Number.isFinite(result) ? result : null;
  }, [form]);

  const setField = <K extends keyof PolicyForm>(field: K, value: PolicyForm[K]) => {
    setForm((current) => current ? { ...current, [field]: value } : current);
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPolicies(search);
  };

  const handleSave = async () => {
    if (!form) return;
    if (!form.change_reason.trim()) {
      setError('โปรดระบุเหตุผลที่แก้ไขก่อนบันทึก');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = localStorage.getItem('labstock_token');
      const response = await fetch('/api/settings/reagent-orders', {
        method: selected?.policy_configured ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...form,
          tests_per_box: toPayloadNumber(form.tests_per_box, true),
          avg_patient_tests_per_month: toPayloadNumber(form.avg_patient_tests_per_month),
          iqc_tests_per_month: toPayloadNumber(form.iqc_tests_per_month),
          documented_actual_withdrawal_boxes: toPayloadNumber(form.documented_actual_withdrawal_boxes, true),
          approved_monthly_target_boxes: toPayloadNumber(form.approved_monthly_target_boxes, true),
          approved_order_qty_boxes: toPayloadNumber(form.approved_order_qty_boxes, true),
          orders_per_month: toPayloadNumber(form.orders_per_month),
          lead_time_days: toPayloadNumber(form.lead_time_days),
          safety_stock_boxes: toPayloadNumber(form.safety_stock_boxes, true),
          min_order_qty_boxes: toPayloadNumber(form.min_order_qty_boxes),
          order_multiple_boxes: toPayloadNumber(form.order_multiple_boxes),
          review_days: toPayloadNumber(form.review_days),
        }),
      });
      const payload = await response.json() as { data?: ReagentOrderPolicy; error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          await loadPolicies(search, form.item_id);
        }
        throw new Error(payload.error || 'ไม่สามารถบันทึกนโยบายได้');
      }

      setNotice('บันทึกนโยบายและประวัติการแก้ไขแล้ว');
      await loadPolicies(search, form.item_id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกนโยบายได้');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || ((user?.role === 'Admin' || user?.role === 'Manager') && loading && policies.length === 0)) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-slate-600">
        <RefreshCw className="animate-spin text-blue-700" size={34} />
        <p className="text-sm">กำลังโหลดนโยบายการสั่งซื้อน้ำยา…</p>
      </div>
    );
  }

  if (!user) return null;

  if (user.role !== 'Admin' && user.role !== 'Manager') {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-center">
        <Lock className="text-rose-600" size={44} />
        <h1 className="text-xl font-bold text-slate-900">ไม่มีสิทธิ์เข้าถึง</h1>
        <p className="max-w-md text-sm text-slate-600">เฉพาะ Admin หรือ Manager เท่านั้นที่แก้ไขนโยบายการสั่งซื้อน้ำยาได้</p>
      </div>
    );
  }

  return (
    <main className="space-y-6 pb-16">
      <header className="flex flex-col justify-between gap-4 border-b border-gray-300 pb-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Lab procurement controls</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">นโยบายการสั่งซื้อน้ำยา</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            ตรวจทานค่าอ้างอิงจากเอกสาร ยอดที่แล็บอนุมัติ และค่าทฤษฎีโดยไม่เปลี่ยนจำนวน PO อัตโนมัติ
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPolicies(search, selected?.item_id)}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-gray-900 transition hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> รีเฟรชข้อมูล
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="ปิดข้อความผิดพลาด" onClick={() => setError(null)}><X size={18} /></button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 size={18} /> {notice}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(430px,0.85fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:flex-row">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหารหัส ชื่อน้ำยา บาร์โค้ด หรือผู้ขาย"
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-400/15"
              />
            </label>
            <button type="submit" className="min-h-11 rounded-lg bg-gray-900 px-4 text-sm font-bold text-white transition hover:bg-gray-950">ค้นหา</button>
          </form>
          <div className="max-h-[690px] overflow-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">น้ำยา</th>
                  <th className="px-3 py-3">สถานะต้นฉบับ</th>
                  <th className="px-3 py-3 text-right">อนุมัติ/รอบ</th>
                  <th className="px-4 py-3 text-right">ใช้งาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {policies.map((policy) => {
                  const active = policy.item_id === selected?.item_id;
                  return (
                    <tr
                      key={policy.item_id}
                      className={`cursor-pointer transition ${active ? 'bg-gray-100' : 'hover:bg-slate-50'}`}
                      onClick={() => choosePolicy(policy)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{policy.name}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">{policy.item_id} {policy.vendor ? `• ${policy.vendor}` : ''}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${policy.source_verification_status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {VERIFICATION_STATUSES.find((status) => status.value === policy.source_verification_status)?.label || 'ไม่ระบุ'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700">{policy.approved_order_qty_boxes ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${policy.policy_configured && policy.enabled ? 'bg-gray-100 text-gray-900' : 'bg-slate-200 text-slate-600'}`}>
                          {policy.policy_configured ? (policy.enabled ? 'เปิด' : 'ปิด') : 'ยังไม่ตั้งค่า'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!loading && policies.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-14 text-center text-sm text-slate-500">ไม่พบนโยบายที่ตรงกับการค้นหา</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <section aria-label="แก้ไขนโยบายการสั่งซื้อ" className="rounded-2xl border border-gray-300 bg-white shadow-sm">
          {!form || !selected ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center text-slate-500">
              <FileText size={34} className="text-slate-400" />
              <p className="text-sm">เลือกรายการน้ำยาจากตารางเพื่อแก้ไขนโยบาย</p>
            </div>
          ) : (
            <div>
              <div className="border-b border-gray-300 bg-gray-50 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs font-bold text-blue-700">{selected.item_id}</p>
                    <h2 className="mt-1 text-lg font-extrabold text-slate-950">{selected.name}</h2>
                    <p className="mt-1 text-xs text-slate-600">Revision {form.expected_revision} • {selected.unit || 'หน่วยไม่ระบุ'}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={form.enabled} onChange={(event) => setField('enabled', event.target.checked)} className="size-4 accent-gray-900" />
                    เปิดใช้งาน
                  </label>
                </div>
              </div>

              <div className="space-y-6 p-5">
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-gray-300 bg-gray-50 p-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">ค่าทฤษฎี (อ่านอย่างเดียว)</p>
                    <p className="mt-1 text-2xl font-extrabold text-slate-950">{theoreticalMonthlyBoxes ?? '—'} <span className="text-sm font-semibold text-slate-500">กล่อง/เดือน</span></p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">ROUND((เฉลี่ยผู้ป่วย + IQC) / tests per box)</p>
                  </div>
                  <div className="border-l border-gray-300 pl-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">รอบอนุมัติ (อ่านอย่างเดียว)</p>
                    <p className="mt-1 text-2xl font-extrabold text-slate-950">{approvedMonthlyFromCycle ?? '—'} <span className="text-sm font-semibold text-slate-500">กล่อง/เดือน</span></p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">อนุมัติต่อรอบ × รอบสั่งต่อเดือน</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="จำนวน tests ต่อกล่อง" value={form.tests_per_box} onChange={(value) => setField('tests_per_box', value)} optional hint="เว้นว่างได้จนกว่าจะยืนยัน Excel ต้นฉบับ" />
                  <NumberField label="จำนวนผู้ป่วยเฉลี่ยต่อเดือน" value={form.avg_patient_tests_per_month} onChange={(value) => setField('avg_patient_tests_per_month', value)} />
                  <NumberField label="IQC เฉพาะรายการต่อเดือน" value={form.iqc_tests_per_month} onChange={(value) => setField('iqc_tests_per_month', value)} />
                  <NumberField label="ยอดเบิกจริงจากเอกสาร (กล่อง)" value={form.documented_actual_withdrawal_boxes} onChange={(value) => setField('documented_actual_withdrawal_boxes', value)} optional />
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">สถานะการตรวจต้นฉบับ</span>
                    <select value={form.source_verification_status} onChange={(event) => setField('source_verification_status', event.target.value as SourceVerificationStatus)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-400/15">
                      {VERIFICATION_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="border-t border-slate-100 pt-5">
                  <h3 className="text-sm font-extrabold text-slate-900">ค่าที่แล็บอนุมัติและข้อจำกัดการสั่ง</h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <NumberField label="เป้าหมายที่อนุมัติต่อเดือน (กล่อง)" value={form.approved_monthly_target_boxes} onChange={(value) => setField('approved_monthly_target_boxes', value)} optional />
                    <NumberField label="จำนวนที่อนุมัติต่อรอบ (กล่อง)" value={form.approved_order_qty_boxes} onChange={(value) => setField('approved_order_qty_boxes', value)} optional integer />
                    <NumberField label="รอบสั่งต่อเดือน" value={form.orders_per_month} onChange={(value) => setField('orders_per_month', value)} integer />
                    <NumberField label="ช่วงคาดการณ์/รอบทบทวน (วัน)" value={form.review_days} onChange={(value) => setField('review_days', value)} integer hint="ค่าเริ่มต้น 15 วัน ใช้คำนวณยอดแนะนำต่อรายการ" />
                    <NumberField label="Lead time (วัน)" value={form.lead_time_days} onChange={(value) => setField('lead_time_days', value)} integer />
                    <NumberField label="Safety stock (กล่อง)" value={form.safety_stock_boxes} onChange={(value) => setField('safety_stock_boxes', value)} optional />
                    <NumberField label="สั่งขั้นต่ำ (กล่อง)" value={form.min_order_qty_boxes} onChange={(value) => setField('min_order_qty_boxes', value)} integer />
                    <NumberField label="ต้องเป็นจำนวนเท่าของ (กล่อง)" value={form.order_multiple_boxes} onChange={(value) => setField('order_multiple_boxes', value)} integer />
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">เหตุผล/ที่มาของนโยบาย</span>
                  <textarea value={form.reason} onChange={(event) => setField('reason', event.target.value)} rows={3} maxLength={2000} className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-400/15" placeholder="เช่น อ้างอิงแผนที่แล็บอนุมัติหรือเอกสารเบิกจริง" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-slate-700">เหตุผลที่แก้ไข <span className="text-rose-600">*</span></span>
                  <textarea value={form.change_reason} onChange={(event) => setField('change_reason', event.target.value)} rows={3} maxLength={2000} required className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-400/15" placeholder="บันทึกเหตุผลสำหรับประวัติการแก้ไข เช่น ตรวจทาน Excel ต้นฉบับแล้ว" />
                </label>

                <button type="button" onClick={() => void handleSave()} disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-gray-950 disabled:cursor-not-allowed disabled:opacity-60">
                  {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />} {saving ? 'กำลังบันทึก…' : 'บันทึกนโยบาย'}
                </button>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
