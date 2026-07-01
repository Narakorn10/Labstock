'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import Modal from '@/components/modal';
import { BarcodePattern, ล็อต, Reagent } from '@/lib/api-client';
import { findMatchingReagent } from '@/lib/barcode-parser';
import QRScanner from '@/components/qr-scanner';
import {
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle,
  HandHelping,
  Loader2,
  PackagePlus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';

type WorkflowMode = 'receive' | 'dispense';

interface MobileStockWorkflowProps {
  mode: WorkflowMode;
  deepLinkCode?: string;
  deepLinkล็อต?: string;
}

interface MobileCartItem {
  cartId: string;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  unit: string;
  expDate: string;
  maxQty?: number;
  availableล็อตs?: ล็อต[];
}

interface MobileLookupResponse {
  reagents: Reagent[];
  patterns: BarcodePattern[];
}

interface Rememberedผู้อนุมัติ {
  username: string;
  name: string;
  role: string;
}

const createCartId = (itemId: string) => `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const MOBILE_APPROVER_STORAGE_KEY = 'labstock_mobile_approver';

const readStoredผู้อนุมัติ = (): Rememberedผู้อนุมัติ | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(MOBILE_APPROVER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Rememberedผู้อนุมัติ>;
    if (!parsed.username || !parsed.name || !parsed.role) return null;

    return {
      username: parsed.username,
      name: parsed.name,
      role: parsed.role,
    };
  } catch (error) {
    console.error('Failed to load mobile approver:', error);
    return null;
  }
};

export default function MobileStockWorkflow({ mode, deepLinkCode = '', deepLinkล็อต = '' }: MobileStockWorkflowProps) {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<MobileCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approverชื่อผู้ใช้, setผู้อนุมัติชื่อผู้ใช้] = useState(() => readStoredผู้อนุมัติ()?.username || '');
  const [approverPin, setผู้อนุมัติPin] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [rememberedผู้อนุมัติ, setRememberedผู้อนุมัติ] = useState<Rememberedผู้อนุมัติ | null>(() => readStoredผู้อนุมัติ());
  const [changeผู้อนุมัติMode, setChangeผู้อนุมัติMode] = useState(false);
  const processedDeepLinkRef = useRef('');

  const isReceive = mode === 'receive';

  const loadLookupData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/mobile/lookup');
      const data = await response.json() as MobileLookupResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || 'ไม่สามารถโหลดข้อมูลหน้า mobile ได้');
      }

      setReagents(data.reagents);
      setPatterns(data.patterns);
    } catch (err: unknown) {
      console.error(err);
      const error = err as { message?: string };
      setLoadError(error.message || 'ไม่สามารถโหลดข้อมูลหน้า mobile ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadLookupData);
  }, [loadLookupData]);

  const filteredResults = useMemo(() => {
    if (!search.trim()) return [];
    return reagents
      .filter((reagent) =>
        reagent.name.toLowerCase().includes(search.toLowerCase()) ||
        reagent.itemId.toLowerCase().includes(search.toLowerCase()) ||
        (reagent.qrCode || '').toLowerCase().includes(search.toLowerCase())
      )
      .slice(0, 6);
  }, [search, reagents]);

  const addReceiveItem = (match: Reagent, lotNo: string = '', expDate: string = '') => {
    const newItem: MobileCartItem = {
      cartId: createCartId(match.itemId),
      itemId: match.itemId,
      name: match.name,
      lotNo,
      expDate,
      qty: 1,
      unit: match.unit,
    };

    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);
      if (existing) {
        return prev.map((item) => (item.cartId === existing.cartId ? { ...item, qty: item.qty + 1 } : item));
      }
      return [newItem, ...prev];
    });

    setFeedback({ type: 'success', msg: `เพิ่ม ${match.name} เข้าในคิวรับเข้าแล้ว` });
  };

  const addDispenseItem = (match: Reagent, lotOverride?: string) => {
    if (match.lots.length === 0) {
      setFeedback({ type: 'error', msg: `ไม่พบสต๊อกที่พร้อมใช้งานสำหรับ ${match.name}` });
      return;
    }

    const sortedล็อตs = [...match.lots].sort(
      (a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime()
    );
    let selectedล็อต = sortedล็อตs[0];

    if (lotOverride) {
      const exactล็อต = sortedล็อตs.find((lot) => lot.lotNo.toLowerCase() === lotOverride.toLowerCase());
      if (exactล็อต) selectedล็อต = exactล็อต;
    }

    const newItem: MobileCartItem = {
      cartId: createCartId(match.itemId),
      itemId: match.itemId,
      name: match.name,
      lotNo: selectedล็อต.lotNo,
      expDate: selectedล็อต.expDate,
      qty: 1,
      unit: match.unit,
      maxQty: selectedล็อต.qty,
      availableล็อตs: sortedล็อตs,
    };

    setCart((prev) => {
      const existing = prev.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);
      if (existing) {
        return prev.map((item) =>
          item.cartId === existing.cartId
            ? { ...item, qty: Math.min(item.qty + 1, item.maxQty || item.qty + 1) }
            : item
        );
      }
      return [newItem, ...prev];
    });

    setFeedback({ type: 'success', msg: `Added ${match.name} (${selectedล็อต.lotNo}) to dispense queue.` });
  };

  const addToCart = useCallback(
    (match: Reagent, lotNo?: string, expDate?: string) => {
      if (isReceive) {
        addReceiveItem(match, lotNo || '', expDate || '');
      } else {
        addDispenseItem(match, lotNo);
      }

      setSearch('');
      setShowResults(false);
    },
    [isReceive]
  );

  useEffect(() => {
    if (isReceive || loading || !deepLinkCode) return;

    const deepLinkKey = `${deepLinkCode}::${deepLinkล็อต}`;
    if (processedDeepLinkRef.current === deepLinkKey) return;

    const { data, match, lookupValues } = findMatchingReagent(deepLinkCode, patterns, reagents);
    processedDeepLinkRef.current = deepLinkKey;

    queueMicrotask(() => {
      if (!data) {
        setFeedback({ type: 'error', msg: 'ไม่สามารถอ่าน QR link สำหรับเบิกจ่ายนี้ได้' });
        return;
      }

      if (!match) {
        const parsedId = data.gtin || data.rawString || '-';
        const parsedล็อต = deepLinkล็อต || (data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot);
        setFeedback({
          type: 'error',
          msg: `No reagent match found from link. code: ${parsedId} | lot: ${parsedล็อต} | keys: ${lookupValues.join(', ') || '-'}`,
        });
        return;
      }

      addToCart(
        match,
        deepLinkล็อต || (data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot),
        data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate
      );
    });
  }, [addToCart, deepLinkCode, deepLinkล็อต, isReceive, loading, patterns, reagents]);

  const handleScan = useCallback(
    (decodedText: string) => {
      const { data, match, lookupValues } = findMatchingReagent(decodedText, patterns, reagents);
      if (!data) {
        setFeedback({ type: 'error', msg: 'ไม่สามารถอ่านบาร์โค้ดนี้ได้' });
        setScanMode(false);
        return;
      }

      if (!match) {
        const parsedId = data.gtin || data.rawString || '-';
        const parsedล็อต = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
        setFeedback({
          type: 'error',
          msg: `No reagent match found. code: ${parsedId} | lot: ${parsedล็อต} | keys: ${lookupValues.join(', ') || '-'}`,
        });
        setScanMode(false);
        return;
      }

      addToCart(
        match,
        data.lot === 'NEED_MANUAL_INPUT' ? '' : data.lot,
        data.expDate === 'NEED_MANUAL_INPUT' ? '' : data.expDate
      );
      setScanMode(false);
    },
    [addToCart, patterns, reagents]
  );

  const handleManualAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const removeFromCart = (cartId: string) => {
    setCart((prev) => prev.filter((item) => item.cartId !== cartId));
  };

  const updateQty = (cartId: string, newQty: string) => {
    const parsedQty = parseInt(newQty, 10) || 0;
    setCart((prev) =>
      prev.map((item) => {
        if (item.cartId !== cartId) return item;
        const limitedQty = isReceive ? parsedQty : Math.min(parsedQty, item.maxQty || parsedQty);
        return { ...item, qty: limitedQty };
      })
    );
  };

  const updateReceiveField = (cartId: string, field: 'lotNo' | 'expDate', value: string) => {
    setCart((prev) => prev.map((item) => (item.cartId === cartId ? { ...item, [field]: value } : item)));
  };

  const updateDispenseล็อต = (cartId: string, selectedล็อตNo: string) => {
    setCart((prev) => {
      const currentItem = prev.find((item) => item.cartId === cartId);
      if (!currentItem?.availableล็อตs) return prev;

      const selectedล็อต = currentItem.availableล็อตs.find((lot) => lot.lotNo === selectedล็อตNo);
      if (!selectedล็อต) return prev;

      const duplicateItem = prev.find(
        (item) =>
          item.cartId !== cartId &&
          item.itemId === currentItem.itemId &&
          item.lotNo === selectedล็อต.lotNo
      );

      if (duplicateItem) {
        return prev
          .filter((item) => item.cartId !== cartId)
          .map((item) =>
            item.cartId === duplicateItem.cartId
              ? { ...item, qty: Math.min(item.qty + currentItem.qty, item.maxQty || item.qty + currentItem.qty) }
              : item
          );
      }

      return prev.map((item) =>
        item.cartId === cartId
          ? {
              ...item,
              lotNo: selectedล็อต.lotNo,
              expDate: selectedล็อต.expDate,
              maxQty: selectedล็อต.qty,
              qty: Math.min(item.qty, selectedล็อต.qty),
            }
          : item
      );
    });
  };

  const openConfirm = () => {
    const validItems = cart.filter((item) => item.qty > 0);
    if (validItems.length === 0) {
      setFeedback({ type: 'error', msg: 'กรุณาระบุจำนวนที่มากกว่า 0' });
      return;
    }

    setConfirmError('');
    setChangeผู้อนุมัติMode(!rememberedผู้อนุมัติ);
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    const validItems = cart.filter((item) => item.qty > 0);

    if (validItems.length === 0) {
      setConfirmError('กรุณาระบุจำนวนที่มากกว่า 0');
      return;
    }

    const submitชื่อผู้ใช้ = (changeผู้อนุมัติMode ? approverชื่อผู้ใช้ : rememberedผู้อนุมัติ?.username || approverชื่อผู้ใช้).trim();

    if (!submitชื่อผู้ใช้ || !approverPin.trim()) {
      setConfirmError(changeผู้อนุมัติMode || !rememberedผู้อนุมัติ ? 'ชื่อผู้ใช้ and PIN are required.' : 'กรุณากรอก PIN');
      return;
    }

    setSubmitting(true);
    setConfirmError('');

    try {
      const response = await fetch('/api/mobile/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          username: submitชื่อผู้ใช้,
          pin: approverPin.trim(),
          batchItems: validItems,
        }),
      });

      const result = await response.json() as { error?: string; approver?: { username?: string; name: string; role: string } };
      if (!response.ok) {
        throw new Error(result.error || 'ส่งรายการไม่สำเร็จ');
      }

      const nextผู้อนุมัติ = {
        username: result.approver?.username || submitชื่อผู้ใช้,
        name: result.approver?.name || submitชื่อผู้ใช้,
        role: result.approver?.role || 'User',
      };

      setRememberedผู้อนุมัติ(nextผู้อนุมัติ);
      setผู้อนุมัติชื่อผู้ใช้(nextผู้อนุมัติ.username);
      setChangeผู้อนุมัติMode(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem(MOBILE_APPROVER_STORAGE_KEY, JSON.stringify(nextผู้อนุมัติ));
      }

      setFeedback({
        type: 'success',
        msg: isReceive
          ? `Received ${validItems.length} item(s). Approved by ${result.approver?.name || submitชื่อผู้ใช้}.`
          : `Dispensed ${validItems.length} item(s). Approved by ${result.approver?.name || submitชื่อผู้ใช้}.`,
      });
      setCart([]);
      setผู้อนุมัติPin('');
      setConfirmOpen(false);
      await loadLookupData();
    } catch (err: unknown) {
      const error = err as { message?: string };
      setConfirmError(error.message || 'ส่งรายการไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  const pageTitle = isReceive ? 'รับเข้าบนมือถือ' : 'เบิกจ่ายบนมือถือ';
  const pageDescription = isReceive
    ? 'ขั้นตอนรับเข้าแบบเน้นสแกนก่อน ปุ่มใหญ่ และกรอกล็อตได้รวดเร็ว'
    : 'ขั้นตอนเบิกจ่ายแบบเน้นสแกนก่อน ใช้ FEFO อัตโนมัติ และเลือกล็อตได้รวดเร็ว';
  const activeผู้อนุมัติชื่อผู้ใช้ = (changeผู้อนุมัติMode ? approverชื่อผู้ใช้ : rememberedผู้อนุมัติ?.username || approverชื่อผู้ใช้).trim();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <Loader2 className="animate-spin text-blue-600" size={42} />
        <p className="text-sm font-bold text-gray-500">กำลังโหลดหน้าการทำงานบนมือถือ...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7f9]">
      <div className="max-w-md mx-auto px-4 py-4 pb-28 space-y-4">
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-4 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <Link href="/mobile" className="w-11 h-11 rounded-2xl bg-gray-100 text-gray-700 flex items-center justify-center">
              <ArrowLeft size={20} />
            </Link>
            <div className="text-right">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">สแกนก่อน</p>
              <h1 className="text-xl font-black text-gray-900">{pageTitle}</h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/mobile/receive"
              className={`h-12 rounded-2xl text-sm font-black flex items-center justify-center ${
                isReceive ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Receive
            </Link>
            <Link
              href="/mobile/dispense"
              className={`h-12 rounded-2xl text-sm font-black flex items-center justify-center ${
                !isReceive ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              Dispense
            </Link>
          </div>

          <p className="text-xs font-medium text-gray-500">{pageDescription}</p>
        </div>

        {feedback && (
          <div
            className={`p-4 rounded-[1.5rem] border flex items-center gap-3 ${
              feedback.type === 'success'
                ? 'bg-green-50 text-green-700 border-green-100'
                : 'bg-red-50 text-red-700 border-red-100'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            <p className="text-sm font-bold flex-1">{feedback.msg}</p>
            <button onClick={() => setFeedback(null)} className="text-xs font-black uppercase">
              ปิด
            </button>
          </div>
        )}

        {loadError && (
          <div className="p-4 rounded-[1.5rem] bg-red-50 border border-red-100 text-red-700 text-sm font-bold">
            {loadError}
          </div>
        )}

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-3">
          <button
            onClick={() => setScanMode(true)}
            className={`w-full h-16 rounded-[1.5rem] font-black text-base text-white flex items-center justify-center gap-3 ${
              isReceive ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            <Camera size={22} />
            สแกนบาร์โค้ด
          </button>

          <form onSubmit={handleManualAdd} className="space-y-3">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="พิมพ์รหัส ชื่อน้ำยา หรือบาร์โค้ด..."
                className="w-full h-14 pl-11 pr-4 rounded-2xl border border-gray-200 bg-gray-50 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
              />
              {showResults && filteredResults.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden">
                  {filteredResults.map((item) => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-none"
                    >
                      <p className="text-sm font-black text-gray-900">{item.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">รหัส: {item.itemId}</p>
                    </button>
                  ))}
                </div>
              )}
              {showResults && <div className="fixed inset-0 z-0" onClick={() => setShowResults(false)} />}
            </div>
            <button type="submit" className="w-full h-12 rounded-2xl bg-slate-900 text-white text-sm font-black">
              เพิ่มด้วยตนเอง
            </button>
          </form>
        </div>

        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">คิวรายการ</p>
              <h2 className="text-lg font-black text-gray-900">{cart.length} รายการ</h2>
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs font-black uppercase text-red-500">
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="rounded-[1.5rem] border-2 border-dashed border-gray-100 bg-gray-50 p-8 text-center">
              {isReceive ? <PackagePlus className="mx-auto text-gray-300 mb-3" size={40} /> : <HandHelping className="mx-auto text-gray-300 mb-3" size={40} />}
              <p className="text-sm font-bold text-gray-400">เริ่มต้นด้วยการสแกนหรือค้นหา</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.cartId} className="rounded-[1.5rem] border border-gray-100 bg-gray-50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-gray-900 truncate">{item.name}</h3>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">รหัส: {item.itemId}</p>
                    </div>
                    <button onClick={() => removeFromCart(item.cartId)} className="w-10 h-10 rounded-2xl bg-white text-gray-400 flex items-center justify-center">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {isReceive ? (
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="text"
                        value={item.lotNo}
                        onChange={(e) => updateReceiveField(item.cartId, 'lotNo', e.target.value)}
                        placeholder="ล็อต number"
                        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="date"
                        value={item.expDate}
                        onChange={(e) => updateReceiveField(item.cartId, 'expDate', e.target.value)}
                        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">ล็อต</label>
                      <select
                        value={item.lotNo}
                        onChange={(e) => updateDispenseล็อต(item.cartId, e.target.value)}
                        className="w-full h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-red-500"
                      >
                        {item.availableล็อตs?.map((lot) => (
                          <option key={`${item.itemId}-${lot.lotNo}`} value={lot.lotNo}>
                            {lot.lotNo}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] font-bold text-gray-500 flex items-center gap-2">
                        <Calendar size={12} />
                        หมดอายุ {item.expDate} | สูงสุด {item.maxQty} {item.unit}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max={item.maxQty}
                      value={item.qty}
                      onChange={(e) => updateQty(item.cartId, e.target.value)}
                      className="flex-1 h-12 rounded-2xl border border-gray-200 bg-white px-4 text-center text-lg font-black text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="min-w-16 text-center">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">หน่วย</p>
                      <p className="text-sm font-black text-gray-700">{item.unit}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-4">
          <div className="max-w-md mx-auto">
            <button
              onClick={openConfirm}
              disabled={submitting}
              className={`w-full h-16 rounded-[1.5rem] text-white font-black text-base flex items-center justify-center gap-3 ${
                isReceive ? 'bg-green-600' : 'bg-red-600'
              } disabled:opacity-50`}
            >
              {submitting ? <Loader2 size={22} className="animate-spin" /> : <CheckCircle size={22} />}
              {isReceive ? `ยืนยันรับเข้า ${cart.length} รายการ` : `ยืนยันเบิกจ่าย ${cart.length} รายการ`}
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onปิด={() => {
          if (!submitting) {
            setConfirmOpen(false);
            setConfirmError('');
            setผู้อนุมัติPin('');
            setChangeผู้อนุมัติMode(!rememberedผู้อนุมัติ);
          }
        }}
        title={isReceive ? 'อนุมัติรายการรับเข้า' : 'อนุมัติรายการเบิกจ่าย'}
        maxWidth="max-w-md"
      >
        <div className="space-y-5">
          <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">ต้องมีการอนุมัติ</p>
            <p className="mt-2 text-sm font-medium text-gray-600">
              {rememberedผู้อนุมัติ && !changeผู้อนุมัติMode
                ? `ยืนยันรายการ${isReceive ? 'รับเข้า' : 'เบิกจ่าย'}นี้ด้วย PIN`
                : `กรอกชื่อผู้ใช้และ PIN เพื่ออนุมัติรายการ${isReceive ? 'รับเข้า' : 'เบิกจ่าย'}นี้`}
            </p>
          </div>

          {rememberedผู้อนุมัติ && !changeผู้อนุมัติMode ? (
            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 space-y-2">
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">ผู้อนุมัติ</p>
              <p className="text-sm font-black text-gray-900">{rememberedผู้อนุมัติ.name}</p>
              <p className="text-xs font-bold text-gray-500">
                {rememberedผู้อนุมัติ.username} â€¢ {rememberedผู้อนุมัติ.role}
              </p>
              <button
                type="button"
                onClick={() => {
                  setChangeผู้อนุมัติMode(true);
                  setผู้อนุมัติชื่อผู้ใช้(rememberedผู้อนุมัติ.username);
                  setConfirmError('');
                }}
                className="text-xs font-black uppercase text-blue-600"
              >
                Change ผู้อนุมัติ
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">ชื่อผู้ใช้</label>
              <input
                type="text"
                value={approverชื่อผู้ใช้}
                onChange={(e) => setผู้อนุมัติชื่อผู้ใช้(e.target.value)}
                placeholder="ตัวอย่าง staff01"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={approverPin}
              onChange={(e) => setผู้อนุมัติPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={activeผู้อนุมัติชื่อผู้ใช้ ? `PIN for ${activeผู้อนุมัติชื่อผู้ใช้}` : '4-6 หลัก'}
              className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          {confirmError && (
            <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm font-bold text-red-700">
              {confirmError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
              isReceive ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
            ยืนยันด้วย PIN
          </button>
        </div>
      </Modal>

      {scanMode && <QRScanner onScan={handleScan} onปิด={() => setScanMode(false)} />}
    </div>
  );
}
