'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient, BarcodePattern, BarcodePatternV2, BarcodePatternV2Example, Reagent } from '@/lib/api-client';
import { processAnyBarcode } from '@/lib/barcode-parser';
import { Trash2, Plus, Loader2, CheckCircle, Save, Camera, AlertCircle, ArrowRight, ArrowLeft, Power, PowerOff, ClipboardCheck } from 'lucide-react';
import QRScanner from '@/components/lazy-qr-scanner';
import QrCharPicker, { type QrField } from '@/components/qr-char-picker';
import { previewV2Values } from '@/lib/barcode-learning-v2-derive';

function V2StatusLabel({ status }: { status: BarcodePatternV2['status'] }) {
  const labels: Record<BarcodePatternV2['status'], string> = {
    DRAFT: 'ฉบับร่าง',
    VERIFIED: 'พร้อมเปิดใช้',
    ACTIVE: 'เปิดใช้งาน',
    INACTIVE: 'ปิดใช้งาน',
  };
  const colors: Record<BarcodePatternV2['status'], string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    VERIFIED: 'bg-amber-50 text-amber-800',
    ACTIVE: 'bg-emerald-50 text-emerald-800',
    INACTIVE: 'bg-rose-50 text-rose-800',
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${colors[status]}`}>{labels[status]}</span>;
}

const createEmptyV2Examples = (): BarcodePatternV2Example[] => [
  { raw_barcode: '', expected_item_id: '', expected_lot: '', expected_exp_date: '' },
  { raw_barcode: '', expected_item_id: '', expected_lot: '', expected_exp_date: '' },
];

const ensureTwoV2Examples = (source: BarcodePatternV2Example[]) => {
  const examples = source.slice(0, 2);
  while (examples.length < 2) {
    examples.push({ raw_barcode: '', expected_item_id: '', expected_lot: '', expected_exp_date: '' });
  }
  return examples;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  const apiError = error as {
    response?: { data?: { error?: unknown; message?: unknown } };
    message?: unknown;
  };
  const responseError = apiError.response?.data?.error ?? apiError.response?.data?.message;
  if (typeof responseError === 'string' && responseError.trim()) return responseError;
  if (typeof apiError.message === 'string' && apiError.message.trim()) return apiError.message;
  return fallback;
}

function BarcodeLearningV2Panel() {
  const [patterns, setPatterns] = useState<BarcodePatternV2[]>([]);
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [mappingMode, setMappingMode] = useState<'CAPTURED_IDENTIFIER' | 'FIXED_REAGENT'>('CAPTURED_IDENTIFIER');
  const [fixedItemId, setFixedItemId] = useState('');
  const [examples, setExamples] = useState<BarcodePatternV2Example[]>(createEmptyV2Examples);
  const [regexPattern, setRegexPattern] = useState('');
  const [itemIdGroup, setItemIdGroup] = useState<number | null>(null);
  const [lotNoGroup, setLotNoGroup] = useState<number | null>(null);
  const [expDateGroup, setExpDateGroup] = useState<number | null>(null);
  const [advancedRegexEnabled, setAdvancedRegexEnabled] = useState(false);
  const [verification, setVerification] = useState<BarcodePatternV2['verification'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scannerIndex, setScannerIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingPatternId, setEditingPatternId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedPatterns, loadedReagents] = await Promise.all([
        apiClient.getBarcodeV2Patterns(),
        apiClient.getDashboard(),
      ]);
      setPatterns(loadedPatterns);
      setReagents(loadedReagents);
      setError('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'ยังโหลดรูปแบบ V2 ไม่ได้ กรุณาตรวจสิทธิ์เมนูสอนอ่านบาร์โค้ด'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    try {
      const user = JSON.parse(localStorage.getItem('labstock_user') || '{}') as { role?: string };
      setIsAdmin(user.role === 'Admin');
    } catch {
      setIsAdmin(false);
    }
  }, [load]);

  const pickerFields: QrField[] = mappingMode === 'CAPTURED_IDENTIFIER' ? ['item', 'lot', 'exp'] : ['lot', 'exp'];
  const fieldKeys: Record<QrField, keyof BarcodePatternV2Example> = { item: 'expected_item_id', lot: 'expected_lot', exp: 'expected_exp_date' };
  const valuesOf = (example: BarcodePatternV2Example) => ({ item: example.expected_item_id, lot: example.expected_lot, exp: example.expected_exp_date });

  const updateExample = (index: number, field: keyof BarcodePatternV2Example, value: string) => {
    setExamples((current) => current.map((example, exampleIndex) => exampleIndex === index ? { ...example, [field]: value } : example));
    setVerification(null);
  };

  // The second sample is read with the positions learned from the first, so the user only checks the result.
  const setSecondRaw = (raw: string) => {
    const preview = previewV2Values({ name, mapping_mode: mappingMode, fixed_item_id: fixedItemId || null, examples: [examples[0]] }, raw);
    setExamples((current) => [current[0], {
      raw_barcode: raw,
      expected_item_id: mappingMode === 'CAPTURED_IDENTIFIER' ? preview?.item ?? '' : '',
      expected_lot: preview?.lot ?? '',
      expected_exp_date: preview?.exp ?? '',
    }]);
    setVerification(null);
  };

  const setRaw = (index: number, raw: string) => {
    if (index === 1) setSecondRaw(raw);
    else updateExample(0, 'raw_barcode', raw);
  };

  const parseCaptureGroup = (value: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  const updateAdvancedRegex = (value: string) => {
    setRegexPattern(value);
    setAdvancedRegexEnabled(Boolean(value.trim()));
    setVerification(null);
  };

  const updateCaptureGroup = (setter: (value: number | null) => void, value: string) => {
    setter(parseCaptureGroup(value));
    setAdvancedRegexEnabled(true);
    setVerification(null);
  };

  const payload = () => ({
    name,
    mapping_mode: mappingMode,
    fixed_item_id: mappingMode === 'FIXED_REAGENT' ? fixedItemId : null,
    // Only an Admin-authored Regex is sent as an advanced mapping. An
    // auto-derived Regex is displayed locally, but the server derives it
    // again from the examples so non-Admin users never submit capture
    // groups as an advanced override.
    regex_pattern: isAdmin && advancedRegexEnabled ? regexPattern : '',
    item_id_group: isAdmin && advancedRegexEnabled ? itemIdGroup : null,
    lot_no_group: isAdmin && advancedRegexEnabled ? lotNoGroup : null,
    exp_date_group: isAdmin && advancedRegexEnabled ? expDateGroup : null,
    examples,
  });

  const validate = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await apiClient.validateBarcodeV2Pattern(payload());
      const resultData = result.data;
      setVerification(resultData?.verification || null);
      // Keep the server's complete mapping. In particular, a generated Regex
      // is only useful when its capture-group indexes travel with it.
      if (typeof resultData?.regex_pattern === 'string') setRegexPattern(resultData.regex_pattern);
      setItemIdGroup(resultData?.item_id_group ?? null);
      setLotNoGroup(resultData?.lot_no_group ?? null);
      setExpDateGroup(resultData?.exp_date_group ?? null);
      setStep(3);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'ตรวจสอบรูปแบบไม่สำเร็จ กรุณาตรวจตัวอย่างและลองใหม่'));
    } finally {
      setSaving(false);
    }
  };

  const resetWizard = () => {
    setEditingPatternId(null);
    setStep(1);
    setName('');
    setMappingMode('CAPTURED_IDENTIFIER');
    setFixedItemId('');
    setRegexPattern('');
    setItemIdGroup(null);
    setLotNoGroup(null);
    setExpDateGroup(null);
    setAdvancedRegexEnabled(false);
    setExamples(createEmptyV2Examples());
    setVerification(null);
    setError('');
  };

  const save = async (activateAfterSave: boolean) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = editingPatternId !== null
        ? await apiClient.updateBarcodeV2Pattern(editingPatternId, payload())
        : await apiClient.createBarcodeV2Pattern(payload());
      const saved = result.data?.pattern;
      if (activateAfterSave && saved?.status === 'VERIFIED') {
        try {
          await apiClient.activateBarcodeV2Pattern(saved.id);
          setNotice(`เปิดใช้ "${saved.name}" แล้ว สแกน QR แบบนี้ได้ทันที`);
        } catch (err: unknown) {
          setNotice(`บันทึก "${saved.name}" แล้ว แต่ยังเปิดใช้ไม่ได้: ${getApiErrorMessage(err, 'กรุณาลองกดเปิดใช้อีกครั้ง')}`);
        }
      } else {
        setNotice(saved?.status === 'VERIFIED' ? `บันทึก "${saved.name}" แล้ว กด "เปิดใช้" ในรายการด้านขวาเมื่อพร้อม` : 'บันทึกเป็นฉบับร่างแล้ว');
      }
      resetWizard();
      await load();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, editingPatternId !== null ? 'อัปเดตฉบับร่างไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่' : 'บันทึกไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่'));
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id: number) => {
    if (!confirm('เปิดใช้รูปแบบนี้หรือไม่? ระบบเดิมจะถูกอ่านก่อนเสมอ')) return;
    try {
      await apiClient.activateBarcodeV2Pattern(id);
      await load();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'เปิดใช้ไม่สำเร็จ กรุณาตรวจรูปแบบและสิทธิ์อีกครั้ง'));
    }
  };

  const deactivate = async (id: number) => {
    const reason = prompt('ระบุเหตุผลที่ปิดใช้รูปแบบนี้');
    if (!reason?.trim()) return;
    try {
      await apiClient.deactivateBarcodeV2Pattern(id, reason.trim());
      await load();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'ปิดใช้ไม่สำเร็จ กรุณาลองใหม่'));
    }
  };

  const remove = async (pattern: BarcodePatternV2) => {
    if (!confirm(`ลบ "${pattern.name}" หรือไม่? รูปแบบที่ยังไม่เคยเปิดใช้เท่านั้นที่ลบได้`)) return;
    try {
      await apiClient.deleteBarcodeV2Pattern(pattern.id);
      if (editingPatternId === pattern.id) resetWizard();
      await load();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'ลบไม่สำเร็จ กรุณาลองใหม่'));
    }
  };

  const startEditingDraft = (pattern: BarcodePatternV2) => {
    setEditingPatternId(pattern.id);
    setName(pattern.name);
    setMappingMode(pattern.mapping_mode);
    setFixedItemId(pattern.fixed_item_id || '');
    setRegexPattern(pattern.regex_pattern || '');
    setItemIdGroup(pattern.item_id_group ?? null);
    setLotNoGroup(pattern.lot_no_group ?? null);
    setExpDateGroup(pattern.exp_date_group ?? null);
    // A stored Regex is an explicit mapping when continuing a draft. Keep its
    // capture indexes together with it until the next validation.
    setAdvancedRegexEnabled(Boolean(pattern.regex_pattern) && isAdmin);
    setExamples(ensureTwoV2Examples(pattern.examples));
    setVerification(pattern.verification || null);
    setError('');
    setNotice('');
    setStep(1);
  };

  const first = examples[0];
  const second = examples[1];
  const firstReady = Boolean(name.trim() && first.raw_barcode.trim()
    // A fixed-reagent pattern needs at least one learned position, or it would claim every unknown QR.
    && (mappingMode === 'FIXED_REAGENT' ? fixedItemId && (first.expected_lot || first.expected_exp_date) : first.expected_item_id?.trim()));
  const secondPreview = second.raw_barcode.trim()
    ? previewV2Values({ name, mapping_mode: mappingMode, fixed_item_id: fixedItemId || null, examples: [first] }, second.raw_barcode)
    : null;
  const secondPreviewFailed = Boolean(second.raw_barcode.trim()) && secondPreview === null;
  const verified = verification?.status === 'VERIFIED';

  const valueFields = (index: number) => (
    <div className="grid gap-3 sm:grid-cols-3">
      {pickerFields.map((field) => (
        <label key={field} className="text-xs font-bold text-slate-700">
          {field === 'item' ? 'รหัสสินค้า (Item ID)' : field === 'lot' ? 'Lot' : 'วันหมดอายุ'}
          <input
            value={(examples[index][fieldKeys[field]] as string | undefined) || ''}
            onChange={(event) => updateExample(index, fieldKeys[field], event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm font-normal"
            placeholder="แตะเลือกจาก QR หรือพิมพ์"
          />
        </label>
      ))}
    </div>
  );

  const rawInput = (index: number) => (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-sm font-bold text-slate-700" htmlFor={`v2-raw-${index}`}>ข้อความใน QR</label>
        <button type="button" onClick={() => setScannerIndex(index)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-bold text-white"><Camera size={18} /> สแกน</button>
      </div>
      <textarea id={`v2-raw-${index}`} value={examples[index].raw_barcode} onChange={(event) => setRaw(index, event.target.value)} className="min-h-20 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" placeholder="กดสแกน หรือใช้เครื่องยิงบาร์โค้ด/วางข้อความตรงนี้" />
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="rounded-3xl bg-gray-950 p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">Barcode Learning V2</p>
            <h1 className="mt-2 text-2xl font-black">สอนระบบอ่าน QR/Barcode รูปแบบใหม่</h1>
            <p className="mt-2 max-w-3xl text-sm text-emerald-50/85">สแกน QR 2 ชิ้นที่คนละ Lot แล้วแตะบอกว่าส่วนไหนคือ Lot และวันหมดอายุ รูปแบบเดิมยังถูกอ่านก่อนเสมอ</p>
          </div>
          <button type="button" onClick={resetWizard} className="min-h-11 rounded-xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20">เริ่มรูปแบบใหม่</button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div>}
      {notice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{notice}</div>}

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-6 flex items-center gap-4 overflow-x-auto" aria-label="ขั้นตอนการสอน">
            {[['1', 'QR ชิ้นที่ 1'], ['2', 'QR ชิ้นที่ 2'], ['3', 'บันทึก']].map(([number, label]) => (
              <div key={number} className={`flex min-w-max items-center gap-2 text-sm ${Number(number) === step ? 'font-black text-blue-700' : 'font-semibold text-slate-400'}`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-full border-2 ${Number(number) <= step ? 'border-gray-800 bg-gray-100 text-blue-700' : 'border-slate-200'}`}>{number}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700" htmlFor="v2-name">ชื่อรูปแบบ</label>
                  <input id="v2-name" value={name} onChange={(event) => setName(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-4" placeholder="เช่น Abbott Architect QR" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700" htmlFor="v2-mode">QR นี้บอกรหัสสินค้าไหม</label>
                  <select id="v2-mode" value={mappingMode} onChange={(event) => { setMappingMode(event.target.value as typeof mappingMode); setVerification(null); }} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4">
                    <option value="CAPTURED_IDENTIFIER">มีรหัสสินค้าใน QR</option>
                    <option value="FIXED_REAGENT">ไม่มี — QR นี้ใช้กับน้ำยารายการเดียว</option>
                  </select>
                </div>
              </div>
              {mappingMode === 'FIXED_REAGENT' && (
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700" htmlFor="v2-fixed">น้ำยาใน Master Data</label>
                  <select id="v2-fixed" value={fixedItemId} onChange={(event) => setFixedItemId(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4">
                    <option value="">เลือกน้ำยา</option>
                    {reagents.map((reagent) => <option key={reagent.itemId} value={reagent.itemId}>{reagent.itemId} — {reagent.name}</option>)}
                  </select>
                </div>
              )}
              {rawInput(0)}
              {first.raw_barcode && (
                <QrCharPicker
                  raw={first.raw_barcode}
                  fields={pickerFields}
                  values={valuesOf(first)}
                  onPick={(field, value) => updateExample(0, fieldKeys[field], value)}
                />
              )}
              {first.raw_barcode && valueFields(0)}
              <div className="flex justify-end"><button type="button" onClick={() => setStep(2)} disabled={!firstReady} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-5 text-sm font-bold text-white disabled:opacity-40">ถัดไป <ArrowRight size={18} /></button></div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-black">สแกน QR ชิ้นที่ 2</h2>
                <p className="mt-1 text-sm text-slate-500">ใช้น้ำยาตัวเดียวกันแต่คนละ Lot ระบบจะอ่านค่าให้เอง แค่ตรวจว่าตรงกับฉลาก</p>
              </div>
              {rawInput(1)}
              {second.raw_barcode && !secondPreviewFailed && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p className="font-bold">ระบบอ่านได้ตามตำแหน่งจาก QR ชิ้นที่ 1 — ตรงกับฉลากไหม? ถ้าไม่ตรงให้แก้ในช่องด้านล่าง</p></div>
              )}
              {secondPreviewFailed && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">QR ชิ้นนี้ยาวไม่เท่าชิ้นที่ 1 ระบบเลยอ่านเองไม่ได้</p><p className="mt-1">แตะเลือกค่าจาก QR ด้านล่างแทน หรือตรวจว่าเป็นน้ำยาแบบเดียวกันจริง</p></div>
              )}
              {secondPreviewFailed && (
                <QrCharPicker
                  raw={second.raw_barcode}
                  fields={pickerFields}
                  values={valuesOf(second)}
                  onPick={(field, value) => updateExample(1, fieldKeys[field], value)}
                />
              )}
              {second.raw_barcode && valueFields(1)}
              <div className="flex justify-between"><button type="button" onClick={() => setStep(1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold"><ArrowLeft size={18} /> ย้อนกลับ</button><button type="button" onClick={validate} disabled={!second.raw_barcode.trim() || saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-5 text-sm font-bold text-white disabled:opacity-40">{saving ? <Loader2 className="animate-spin" size={18} /> : <ClipboardCheck size={18} />} ตรวจสอบ</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {verified ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="flex items-center gap-2 text-base font-black"><CheckCircle size={20} /> ผ่านการตรวจสอบ</p>
                  <p className="mt-1">อ่าน QR ทั้ง 2 ชิ้นได้ถูกต้อง และไม่ชนกับรูปแบบเดิม พร้อมเปิดใช้</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <p className="flex items-center gap-2 text-base font-black"><AlertCircle size={20} /> ยังไม่ผ่าน</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">{(verification?.errors?.length ? verification.errors : ['กด "ตรวจสอบ" อีกครั้งหลังแก้ข้อมูล']).map((item) => <li key={item}>{item}</li>)}</ul>
                  <p className="mt-2 text-xs">กดย้อนกลับไปแก้ตัวอย่าง หรือบันทึกเป็นฉบับร่างไว้ทำต่อภายหลัง</p>
                </div>
              )}
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div><span className="text-slate-500">ชื่อรูปแบบ</span><p className="font-bold">{name}</p></div>
                <div><span className="text-slate-500">รหัสสินค้า</span><p className="font-bold">{mappingMode === 'FIXED_REAGENT' ? `น้ำยา ${fixedItemId} ทุกครั้ง` : 'อ่านจาก QR'}</p></div>
                {examples.map((example, index) => (
                  <div key={index} className="sm:col-span-2"><span className="text-slate-500">QR ชิ้นที่ {index + 1}</span><p className="font-mono text-xs">{mappingMode === 'CAPTURED_IDENTIFIER' && <>รหัส {example.expected_item_id || '-'} · </>}Lot {example.expected_lot || '-'} · หมดอายุ {example.expected_exp_date || '-'}</p></div>
                ))}
              </div>
              {isAdmin && <details className="rounded-2xl border border-slate-200 p-4" open={advancedRegexEnabled}><summary className="cursor-pointer text-sm font-bold">ตัวเลือกขั้นสูงสำหรับ Admin: Regex และตำแหน่ง Capture Group</summary><p className="mt-2 text-xs text-slate-500">ปล่อย Regex ว่างเพื่อให้ระบบสร้างรูปแบบจากตัวอย่างอัตโนมัติ หากแก้ Regex เอง ต้องระบุหมายเลขกลุ่มให้ตรงกับวงเล็บจับค่า แล้วกดตรวจสอบใหม่</p><textarea value={regexPattern} onChange={(event) => updateAdvancedRegex(event.target.value)} className="mt-3 min-h-24 w-full rounded-xl border border-slate-300 p-3 font-mono text-xs" placeholder="เว้นว่างเพื่อให้ระบบสร้าง Regex portable ให้อัตโนมัติ" /><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-xs font-bold text-slate-700">Item ID group<input type="number" min="1" value={itemIdGroup ?? ''} onChange={(event) => updateCaptureGroup(setItemIdGroup, event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" placeholder="เช่น 1" /></label><label className="text-xs font-bold text-slate-700">Lot group<input type="number" min="1" value={lotNoGroup ?? ''} onChange={(event) => updateCaptureGroup(setLotNoGroup, event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" placeholder="เช่น 2" /></label><label className="text-xs font-bold text-slate-700">Expiry group<input type="number" min="1" value={expDateGroup ?? ''} onChange={(event) => updateCaptureGroup(setExpDateGroup, event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" placeholder="เช่น 3" /></label></div>{verification === null && <button type="button" onClick={validate} disabled={saving} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-bold"><ClipboardCheck size={14} /> ตรวจสอบใหม่</button>}</details>}
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" onClick={() => setStep(2)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold"><ArrowLeft size={18} /> แก้ตัวอย่าง</button>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => save(false)} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:opacity-40"><Save size={18} /> {verified ? 'บันทึกไว้ก่อน' : editingPatternId !== null ? 'อัปเดตฉบับร่าง' : 'บันทึกเป็นฉบับร่าง'}</button>
                  {verified && <button type="button" onClick={() => save(true)} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white disabled:opacity-40">{saving ? <Loader2 className="animate-spin" size={18} /> : <Power size={18} />} บันทึกและเปิดใช้</button>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-black">รูปแบบ V2 ที่สอนแล้ว</h2><p className="mt-1 text-sm text-slate-500">การเปิดใช้และปิดใช้จะถูกบันทึก Audit ทุกครั้ง</p>{loading ? <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> กำลังโหลด</div> : <div className="mt-4 space-y-3">{patterns.map((pattern) => <article key={pattern.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{pattern.name}</h3><p className="mt-1 text-xs text-slate-500">{pattern.mapping_mode === 'FIXED_REAGENT' ? `ผูกกับ ${pattern.fixed_item_id}` : 'ดึงรหัสจาก QR'} · {pattern.examples.length}/2 ตัวอย่าง</p></div><V2StatusLabel status={pattern.status} /></div>{pattern.verification?.errors?.length ? <p className="mt-3 text-xs text-rose-700">ยังไม่ผ่าน: {pattern.verification.errors[0]}</p> : <p className="mt-3 text-xs text-emerald-700">ตรวจสอบล่าสุดผ่าน</p>}<div className="mt-3 flex flex-wrap gap-2">{pattern.status === 'VERIFIED' && <button type="button" onClick={() => activate(pattern.id)} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white"><Power size={14} /> เปิดใช้</button>}{pattern.status === 'ACTIVE' && <button type="button" onClick={() => deactivate(pattern.id)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700"><PowerOff size={14} /> ปิดใช้</button>}{(pattern.status === 'DRAFT' || pattern.status === 'VERIFIED') && <button type="button" onClick={() => startEditingDraft(pattern)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold">แก้ไข</button>}{pattern.status !== 'ACTIVE' && !pattern.activated_at && <button type="button" onClick={() => remove(pattern)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-xs font-bold text-slate-400 hover:text-rose-700"><Trash2 size={14} /> ลบ</button>}</div></article>)}{patterns.length === 0 && <p className="py-8 text-center text-sm text-slate-400">ยังไม่มีรูปแบบ V2</p>}</div>}</div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p className="font-black">หลักประกันความปลอดภัย</p><p className="mt-2">V2 จะทำงานเฉพาะ QR ที่ V1 หา Master ไม่พบเท่านั้น หาก validator, cache หรือ runtime มีปัญหา ระบบกลับไปใช้ manual/V1 เดิมโดยอัตโนมัติ</p></div>
        </div>
      </section>
      {scannerIndex !== null && <QRScanner onScan={(value) => { setRaw(scannerIndex, value); setScannerIndex(null); }} onClose={() => setScannerIndex(null)} />}
    </div>
  );
}

export default function BarcodeSettingsPage() {
  const legacyPatternsReadOnly = true;
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  
  const [name, setName] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [itemIdGroup, setItemIdGroup] = useState<number | ''>('');
  const [lotNoGroup, setLotNoGroup] = useState<number | ''>('');
  const [expDateGroup, setExpDateGroup] = useState<number | ''>('');

  const [testString, setTestString] = useState('');
  const [testResult, setTestResult] = useState<{ match: boolean, item?: string, lot?: string, exp?: string } | null>(null);
  const [isGS1Warning, setIsGS1Warning] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'v2' | 'legacy'>('v2');
  
  // Assistant Mode States
  const [assistantMode, setAssistantMode] = useState(false);
  const [selection, setSelection] = useState<{ start: number, end: number } | null>(null);
  const [mapping, setMapping] = useState<{ item?: [number, number], lot?: [number, number], exp?: [number, number] }>({});

  const gs1Result = useMemo(() => {
    const data = processAnyBarcode(testString, []);
    return data?.barcodeType === 'GS1_COMPLIANT' ? data : null;
  }, [testString]);
  const canSave = Boolean(name && regexPattern && testString && testResult?.match && testResult.item && !isGS1Warning);

  const loadPatterns = async () => {
    try {
      const data = await apiClient.getBarcodePatterns();
      setPatterns(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPatterns();
  }, []);

  const generateRegexFromMapping = useCallback(() => {
    if (!testString) return;
    
    // Sort mapped ranges to build positional regex
    const points: { pos: number, type: 'item' | 'lot' | 'exp' | 'skip', len: number }[] = [];
    
    if (mapping.item) points.push({ pos: mapping.item[0], type: 'item', len: mapping.item[1] - mapping.item[0] + 1 });
    if (mapping.lot) points.push({ pos: mapping.lot[0], type: 'lot', len: mapping.lot[1] - mapping.lot[0] + 1 });
    if (mapping.exp) points.push({ pos: mapping.exp[0], type: 'exp', len: mapping.exp[1] - mapping.exp[0] + 1 });
    
    points.sort((a, b) => a.pos - b.pos);
    
    let regex = '^';
    let currentPos = 0;
    let groupIdx = 1;
    let newItemIdx = 0, newLotIdx = 0, newExpIdx = 0;

    points.forEach(p => {
      if (p.pos > currentPos) {
        regex += `.{${p.pos - currentPos}}`;
      }
      regex += `(.{${p.len}})`;
      if (p.type === 'item') newItemIdx = groupIdx;
      if (p.type === 'lot') newLotIdx = groupIdx;
      if (p.type === 'exp') newExpIdx = groupIdx;
      
      currentPos = p.pos + p.len;
      groupIdx++;
    });
    
    regex += '.*$';
    
    setRegexPattern(regex);
    setItemIdGroup(newItemIdx || '');
    setLotNoGroup(newLotIdx || '');
    setExpDateGroup(newExpIdx || '');
  }, [mapping, testString]);

  useEffect(() => {
    if (assistantMode && (mapping.item || mapping.lot || mapping.exp)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      generateRegexFromMapping();
    }
  }, [assistantMode, generateRegexFromMapping, mapping]);

  const handleCharClick = (idx: number) => {
    if (!selection) {
      setSelection({ start: idx, end: idx });
    } else if (selection.start === selection.end && idx !== selection.start) {
      // Set end point
      const start = Math.min(selection.start, idx);
      const end = Math.max(selection.start, idx);
      setSelection({ start, end });
    } else {
      // Reset
      setSelection({ start: idx, end: idx });
    }
  };

  const applySelection = (type: 'item' | 'lot' | 'exp') => {
    if (!selection) return;
    setMapping(prev => ({ ...prev, [type]: [selection.start, selection.end] }));
    setSelection(null);
  };

  const clearAssistant = () => {
    setMapping({});
    setSelection(null);
    setRegexPattern('');
    setItemIdGroup('');
    setLotNoGroup('');
    setExpDateGroup('');
  };

  const handleScan = (text: string) => {
    setShowScanner(false);
    setTestString(text);
  };

  const checkGS1Format = useCallback((text: string) => {
    return processAnyBarcode(text, [])?.barcodeType === 'GS1_COMPLIANT';
  }, []);

  const runTest = useCallback(() => {
    if (!regexPattern || !testString) return;
    
    setIsGS1Warning(checkGS1Format(testString));

    try {
      const regex = new RegExp(regexPattern);
      const match = testString.match(regex);
      if (match) {
        const item = itemIdGroup ? match[Number(itemIdGroup)] : undefined;
        const lot = lotNoGroup ? match[Number(lotNoGroup)] : undefined;
        const exp = expDateGroup ? match[Number(expDateGroup)] : undefined;
        setTestResult({
          match: Boolean(item),
          item,
          lot,
          exp
        });
      } else {
        setTestResult({ match: false });
      }
    } catch {
      setTestResult({ match: false });
    }
  }, [checkGS1Format, expDateGroup, itemIdGroup, lotNoGroup, regexPattern, testString]);

  useEffect(() => {
    if (regexPattern && testString) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      runTest();
    }
  }, [expDateGroup, itemIdGroup, lotNoGroup, regexPattern, runTest, testString]);

  const handleSave = async () => {
    if (!name || !regexPattern) return alert("กรุณาระบุชื่อและ Regex Pattern");
    if (!testString) return alert("กรุณาสแกนหรือวางบาร์โค้ดตัวอย่างก่อนบันทึก");
    if (isGS1Warning) return alert("This barcode is already supported by the GS1/UDI parser. Do not save a duplicate custom pattern.");
    if (!testResult?.match || !testResult.item) return alert("Please test the Regex and capture Item ID before saving.");
    setSaving(true);
    try {
      await apiClient.createBarcodePattern({
        name,
        regex_pattern: regexPattern,
        item_id_group: itemIdGroup ? Number(itemIdGroup) : null,
        lot_no_group: lotNoGroup ? Number(lotNoGroup) : null,
        exp_date_group: expDateGroup ? Number(expDateGroup) : null,
        sample_barcode: testString,
      });
      setName('');
      setRegexPattern('');
      setItemIdGroup('');
      setLotNoGroup('');
      setExpDateGroup('');
      setTestString('');
      setTestResult(null);
      loadPatterns();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } }; message?: string };
      alert("Error: " + (apiError.response?.data?.error || apiError.message || "Unable to save pattern"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('ยืนยันการลบรูปแบบนี้?')) return;
    try {
      await apiClient.deleteBarcodePattern(id);
      loadPatterns();
    } catch {
      alert("Error deleting");
    }
  };

  if (activeTab === 'v2') {
    return (
      <div className="space-y-4">
        <div className="mx-auto flex max-w-6xl gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <button type="button" onClick={() => setActiveTab('v2')} className="min-h-11 flex-1 rounded-xl bg-gray-100 px-4 text-sm font-black text-blue-700">รูปแบบใหม่ V2</button>
          <button type="button" onClick={() => setActiveTab('legacy')} className="min-h-11 flex-1 rounded-xl px-4 text-sm font-bold text-slate-500 hover:bg-slate-50">รูปแบบเดิม</button>
        </div>
        <BarcodeLearningV2Panel />
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  if (legacyPatternsReadOnly) {
    return (
      <div className="mx-auto max-w-4xl space-y-8 animate-in fade-in pb-12">
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <button type="button" onClick={() => setActiveTab('v2')} className="min-h-11 flex-1 rounded-xl px-4 text-sm font-bold text-slate-500 hover:bg-slate-50">รูปแบบใหม่ V2</button>
          <button type="button" onClick={() => setActiveTab('legacy')} className="min-h-11 flex-1 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700">รูปแบบเดิม (อ่านอย่างเดียว)</button>
        </div>
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
          <h1 className="text-2xl font-black">รูปแบบเดิม V1: อ่านอย่างเดียว</h1>
          <p className="mt-2 text-sm leading-6">ระบบยังใช้รูปแบบเดิมเพื่อให้ QR/Barcode และ hardcode ที่ใช้งานอยู่ทำงานต่อเนื่อง แต่ปิดการเพิ่มและลบ V1 แล้ว เพราะ Regex ใหม่อาจเปลี่ยนผลการอ่านของ flow เดิมได้</p>
          <p className="mt-3 text-sm font-bold">หากต้องเพิ่ม QR ใหม่ ให้ใช้ “รูปแบบใหม่ V2” เท่านั้น</p>
        </section>
        <section className="space-y-4">
          <h2 className="text-xl font-bold">รูปแบบ V1 ที่ใช้งานอยู่ ({patterns.length})</h2>
          <div className="grid gap-4">
            {patterns.map((pattern) => (
              <article key={pattern.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-bold text-slate-900">{pattern.name}</h3>
                <code className="mt-2 block break-all rounded bg-pink-50 px-2 py-1 text-sm text-pink-700">{pattern.regex_pattern}</code>
                <div className="mt-2 flex gap-4 text-xs text-slate-500"><span>Item Group: {pattern.item_id_group || '-'}</span><span>Lot Group: {pattern.lot_no_group || '-'}</span><span>Exp Group: {pattern.exp_date_group || '-'}</span></div>
              </article>
            ))}
            {patterns.length === 0 && <div className="rounded-2xl bg-slate-50 p-8 text-center text-slate-400">ยังไม่มีรูปแบบ V1</div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-in fade-in pb-12">
      <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <button type="button" onClick={() => setActiveTab('v2')} className="min-h-11 flex-1 rounded-xl px-4 text-sm font-bold text-slate-500 hover:bg-slate-50">รูปแบบใหม่ V2</button>
        <button type="button" onClick={() => setActiveTab('legacy')} className="min-h-11 flex-1 rounded-xl bg-slate-100 px-4 text-sm font-black text-slate-700">รูปแบบเดิม (Admin)</button>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-[32px] leading-tight font-medium text-ink">ตั้งค่า Barcode/QR Code (Smart Parser)</h1>
      </div>

      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Plus className="text-blue-600" />
          สอนระบบอ่านบาร์โค้ดใหม่
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
              <input 
                type="checkbox" 
                id="assistant" 
                checked={assistantMode} 
                onChange={e => setAssistantMode(e.target.checked)} 
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="assistant" className="text-sm font-bold text-blue-700 cursor-pointer">เปิดโหมดผู้ช่วย (Assistant Mode)</label>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อรูปแบบ (เช่น Roche Custom)</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-xl px-4 py-2" placeholder="ชื่อรูปแบบ" />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Regular Expression (Regex)</label>
              <input type="text" value={regexPattern} onChange={e => setRegexPattern(e.target.value)} className={`w-full border rounded-xl px-4 py-2 font-mono ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="^(.{10})(.{6})(.{8})$" readOnly={assistantMode} />
              {assistantMode && <p className="text-[10px] text-blue-600 mt-1 font-bold">* Regex จะถูกสร้างอัตโนมัติจากโหมดผู้ช่วย</p>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Item ID Group</label>
                <input type="number" value={itemIdGroup} onChange={e => setItemIdGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 1" readOnly={assistantMode} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Lot No Group</label>
                <input type="number" value={lotNoGroup} onChange={e => setLotNoGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 2" readOnly={assistantMode} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Exp Date Group</label>
                <input type="number" value={expDateGroup} onChange={e => setExpDateGroup(e.target.value ? Number(e.target.value) : '')} className={`w-full border rounded-xl px-4 py-2 ${assistantMode ? 'bg-gray-50' : ''}`} placeholder="เช่น 3" readOnly={assistantMode} />
              </div>
            </div>
          </div>

          <div className="space-y-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center justify-between">
                1. แสกนหรือวางบาร์โค้ดที่นี่
                <button onClick={() => setShowScanner(true)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-200">
                  <Camera size={14} /> แสกนทดสอบ
                </button>
              </label>
              <input type="text" value={testString} onChange={e => setTestString(e.target.value)} className="w-full border rounded-xl px-4 py-2 font-mono" placeholder="วางบาร์โค้ดที่นี่เพื่อทดสอบ" />
            </div>

            {gs1Result && (
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-emerald-700 font-bold">
                  <CheckCircle size={18} /> GS1 UDI decoded automatically
                </div>
                <div><strong>GTIN (UDI-DI):</strong> <span className="font-mono">{gs1Result.gtin}</span></div>
                <div><strong>REF (240):</strong> <span className="font-mono">{gs1Result.additionalProductId || '-'}</span></div>
                <div><strong>Lot (10):</strong> <span className="font-mono">{gs1Result.lot === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.lot}</span></div>
                <div><strong>Expiry (17):</strong> <span className="font-mono">{gs1Result.expDate === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.expDate}</span></div>
                <div><strong>Manufacturing (11):</strong> <span className="font-mono">{gs1Result.mfgDate === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.mfgDate}</span></div>
                <div><strong>Serial (21):</strong> <span className="font-mono">{gs1Result.serial === 'NEED_MANUAL_INPUT' ? '-' : gs1Result.serial}</span></div>
                <div className="break-all"><strong>Full UDI:</strong> <span className="font-mono">{gs1Result.udi}</span></div>
              </div>
            )}

            {assistantMode && testString && (
              <div className="bg-white p-4 rounded-xl border border-blue-200 space-y-4 shadow-sm">
                <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">2. เลือกช่วงตัวอักษรที่ต้องการ</div>
                <div className="flex flex-wrap gap-1 font-mono text-sm leading-none bg-gray-50 p-2 rounded-lg border border-gray-100 select-none">
                  {testString.split('').map((char, idx) => {
                    const isSelected = selection && idx >= selection.start && idx <= selection.end;
                    const isItem = mapping.item && idx >= mapping.item[0] && idx <= mapping.item[1];
                    const isLot = mapping.lot && idx >= mapping.lot[0] && idx <= mapping.lot[1];
                    const isExp = mapping.exp && idx >= mapping.exp[0] && idx <= mapping.exp[1];
                    
                    let bgColor = 'bg-white';
                    let textColor = 'text-gray-600';
                    let borderColor = 'border-gray-200';
                    
                    if (isSelected) { bgColor = 'bg-ink'; textColor = 'text-white'; borderColor = 'border-blue-700'; }
                    else if (isItem) { bgColor = 'bg-green-100'; textColor = 'text-green-700'; borderColor = 'border-green-300'; }
                    else if (isLot) { bgColor = 'bg-purple-100'; textColor = 'text-purple-700'; borderColor = 'border-purple-300'; }
                    else if (isExp) { bgColor = 'bg-orange-100'; textColor = 'text-orange-700'; borderColor = 'border-orange-300'; }

                    return (
                      <span 
                        key={idx} 
                        onClick={() => handleCharClick(idx)}
                        className={`cursor-pointer w-6 h-8 flex items-center justify-center rounded border transition-all ${bgColor} ${textColor} ${borderColor} hover:scale-105 active:scale-95`}
                      >
                        {char}
                      </span>
                    );
                  })}
                </div>
                
                <div className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">3. กำหนดประเภท</div>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    onClick={() => applySelection('item')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-green-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-green-700"
                  >
                    เป็น Item ID
                  </button>
                  <button 
                    onClick={() => applySelection('lot')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-purple-700"
                  >
                    เป็น Lot No
                  </button>
                  <button 
                    onClick={() => applySelection('exp')} 
                    disabled={!selection}
                    className="px-2 py-2 bg-orange-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30 hover:bg-orange-700"
                  >
                    เป็น Exp Date
                  </button>
                </div>
                <button 
                  onClick={clearAssistant} 
                  className="w-full py-1 text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors"
                >
                  ล้างการเลือกทั้งหมด
                </button>
              </div>
            )}

            {!assistantMode && testString && regexPattern && testResult && (
              <div className={`p-4 rounded-xl border ${testResult.match ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                {isGS1Warning && (
                  <div className="mb-4 p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm flex items-start gap-2">
                    <AlertCircle className="shrink-0 mt-0.5" size={16} />
                    <div>
                      <strong>แจ้งเตือนความเสี่ยง:</strong> บาร์โค้ดนี้ดูเหมือนจะใช้มาตรฐาน GS1 อยู่แล้ว (ระบบเดิมอ่านได้) 
                      การสอนรูปแบบใหม่ทับซ้อนลงไปอาจทำให้ระบบดึงข้อมูลผิดพลาด แนะนำให้ใช้บาร์โค้ดที่ระบบเดิมอ่านไม่ได้จริงๆ ครับ
                    </div>
                  </div>
                )}
                
                {testResult.match ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-700 font-bold mb-2">
                      <CheckCircle size={18} /> Match Success!
                    </div>
                    <div className="text-sm"><strong>Item ID:</strong> {testResult.item || '-'}</div>
                    <div className="text-sm"><strong>Lot No:</strong> {testResult.lot || '-'}</div>
                    <div className="text-sm"><strong>Exp Date:</strong> {testResult.exp || '-'}</div>
                  </div>
                ) : (
                  <div className="text-red-700 font-bold">❌ ไม่ตรงกับ Regex Pattern</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving || !canSave} className="bg-ink text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} บันทึกรูปแบบ
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold">รูปแบบที่เรียนรู้แล้ว ({patterns.length})</h2>
        <div className="grid gap-4">
          {patterns.map(p => (
            <div key={p.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">{p.name}</h3>
                <code className="text-sm text-pink-600 bg-pink-50 px-2 py-0.5 rounded">{p.regex_pattern}</code>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>Item Group: {p.item_id_group || '-'}</span>
                  <span>Lot Group: {p.lot_no_group || '-'}</span>
                  <span>Exp Group: {p.exp_date_group || '-'}</span>
                </div>
              </div>
              <button onClick={() => handleDelete(p.id)} className="text-gray-400 hover:text-red-500 p-2">
                <Trash2 size={20} />
              </button>
            </div>
          ))}
          {patterns.length === 0 && (
            <div className="text-center p-8 text-gray-400 bg-gray-50 rounded-2xl">ยังไม่มีรูปแบบที่บันทึกไว้</div>
          )}
        </div>
      </div>

      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
