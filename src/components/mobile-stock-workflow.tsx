'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import Modal from '@/components/modal';
import QtyStepper from '@/components/mobile/qty-stepper';
import ScanResultSheet, { LastAddedItem } from '@/components/mobile/scan-result-sheet';
import { BarcodePattern, BarcodePatternV2Runtime, Lot, Reagent } from '@/lib/api-client';
import { findMatchingReagentWithV2 } from '@/lib/barcode-parser';
import { formatThaiDate } from '@/lib/thai-date';
import QRScanner from '@/components/lazy-qr-scanner';
import {
  ArrowLeft,
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
  deepLinkLot?: string;
  lineApprover?: { username: string; name: string; role: string } | null;
  lineIdToken?: string;
}

interface MobileCartItem {
  cartId: string;
  inventoryId?: number;
  itemId: string;
  name: string;
  lotNo: string;
  qty: number;
  unit: string;
  expDate: string;
  receivedOn?: string;
  maxQty?: number;
  availableLots?: Lot[];
}

interface MobileLookupResponse {
  reagents: Reagent[];
  patterns: BarcodePattern[];
  v2Patterns: BarcodePatternV2Runtime[];
}

const createCartId = (itemId: string) => `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fieldClass =
  'h-12 w-full rounded-xl border border-line bg-white px-3.5 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-ink/10';

export default function MobileStockWorkflow({ mode, lineApprover, lineIdToken }: MobileStockWorkflowProps) {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [v2Patterns, setV2Patterns] = useState<BarcodePatternV2Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<MobileCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [lastAdded, setLastAdded] = useState<LastAddedItem | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPin, setApproverPin] = useState('');
  const [confirmError, setConfirmError] = useState('');
  // Latest cart for the add helpers, which run from a memoised scan callback and must not re-create it.
  const cartRef = useRef<MobileCartItem[]>([]);

  const isReceive = mode === 'receive';

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

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
      setV2Patterns(data.v2Patterns || []);
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

    const existing = cartRef.current.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);

    setCart((prev) => {
      const current = prev.find((item) => item.itemId === newItem.itemId && item.lotNo === newItem.lotNo);
      if (current) {
        return prev.map((item) => (item.cartId === current.cartId ? { ...item, qty: item.qty + 1 } : item));
      }
      return [newItem, ...prev];
    });

    setFeedback(null);
    setLastAdded({
      cartId: existing?.cartId ?? newItem.cartId,
      name: match.name,
      lotNo,
      expDate,
      unit: match.unit,
      incremented: true,
    });
  };

  const addDispenseItem = (match: Reagent, lotOverride?: string) => {
    if (match.lots.length === 0) {
      setLastAdded(null);
      setFeedback({ type: 'error', msg: `ไม่พบสต๊อกที่พร้อมใช้งานสำหรับ ${match.name}` });
      return;
    }

    const sortedLots = [...match.lots].sort(
      (a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime()
    );
    // Adding the same reagent again (typed by name) offers the next lot not yet in the cart.
    const lotsInCart = new Set(cartRef.current.filter((item) => item.itemId === match.itemId).map((item) => item.lotNo.toLowerCase()));
    let selectedLot = sortedLots.find((lot) => !lotsInCart.has(lot.lotNo.toLowerCase())) ?? sortedLots[0];

    if (lotOverride) {
      const exactLot = sortedLots.find((lot) => lot.lotNo.toLowerCase() === lotOverride.toLowerCase());
      if (exactLot) selectedLot = exactLot;
    }

    const newItem: MobileCartItem = {
      cartId: createCartId(match.itemId),
      inventoryId: selectedLot.inventoryId,
      itemId: match.itemId,
      name: match.name,
      lotNo: selectedLot.lotNo,
      expDate: selectedLot.expDate,
      receivedOn: selectedLot.receivedOn,
      qty: 1,
      unit: match.unit,
      maxQty: selectedLot.qty,
      availableLots: sortedLots,
    };

    const existing = cartRef.current.find((item) => item.inventoryId === newItem.inventoryId);

    setCart((prev) => {
      const current = prev.find((item) => item.inventoryId === newItem.inventoryId);
      if (current) {
        return prev.map((item) =>
          item.cartId === current.cartId
            ? { ...item, qty: Math.min(item.qty + 1, item.maxQty || item.qty + 1) }
            : item
        );
      }
      return [newItem, ...prev];
    });

    setFeedback(null);
    setLastAdded({
      cartId: existing?.cartId ?? newItem.cartId,
      name: match.name,
      lotNo: selectedLot.lotNo,
      expDate: selectedLot.expDate,
      unit: match.unit,
      incremented: !existing || existing.qty < (existing.maxQty || existing.qty + 1),
    });
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

  const handleScan = useCallback(
    (decodedText: string) => {
      const { data, match, lookupValues } = findMatchingReagentWithV2(decodedText, patterns, v2Patterns, reagents, v2Patterns.length > 0);
      if (!data) {
        setLastAdded(null);
        setFeedback({ type: 'error', msg: 'ไม่สามารถอ่านบาร์โค้ดนี้ได้' });
        setScanMode(false);
        return;
      }

      if (!match) {
        const parsedId = data.gtin || data.rawString || '-';
        const parsedLot = data.lot === 'NEED_MANUAL_INPUT' ? '-' : data.lot;
        setLastAdded(null);
        setFeedback({
          type: 'error',
          msg: `ไม่พบข้อมูลน้ำยาในระบบ | รหัส: ${parsedId} | ล็อต: ${parsedLot} | คำค้น: ${lookupValues.join(', ') || '-'}`,
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
    [addToCart, patterns, reagents, v2Patterns]
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

  const undoLastAdded = () => {
    if (!lastAdded) return;
    const { cartId } = lastAdded;
    setCart((prev) => {
      const item = prev.find((entry) => entry.cartId === cartId);
      if (!item) return prev;
      if (item.qty <= 1) return prev.filter((entry) => entry.cartId !== cartId);
      return prev.map((entry) => (entry.cartId === cartId ? { ...entry, qty: entry.qty - 1 } : entry));
    });
    setLastAdded(null);
  };

  const scanNext = () => {
    setLastAdded(null);
    setFeedback(null);
    setScanMode(true);
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

  const updateDispenseLot = (cartId: string, selectedInventoryId: string) => {
    setCart((prev) => {
      const currentItem = prev.find((item) => item.cartId === cartId);
      if (!currentItem?.availableLots) return prev;

      const selectedLot = currentItem.availableLots.find((lot) => String(lot.inventoryId) === selectedInventoryId);
      if (!selectedLot) return prev;

      const duplicateItem = prev.find(
        (item) =>
          item.cartId !== cartId &&
          item.inventoryId === selectedLot.inventoryId
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
              inventoryId: selectedLot.inventoryId,
              lotNo: selectedLot.lotNo,
              expDate: selectedLot.expDate,
              receivedOn: selectedLot.receivedOn,
              maxQty: selectedLot.qty,
              qty: Math.min(item.qty, selectedLot.qty),
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

    setLastAdded(null);
    setConfirmError('');
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    const validItems = cart.filter((item) => item.qty > 0);

    if (validItems.length === 0) {
      setConfirmError('กรุณาระบุจำนวนที่มากกว่า 0');
      return;
    }

    if (!lineIdToken && (!approverUsername.trim() || !approverPin.trim())) {
      setConfirmError('กรุณากรอกชื่อผู้ใช้และ PIN');
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
          username: approverUsername.trim(),
          pin: approverPin.trim(),
          lineIdToken,
          batchItems: validItems,
        }),
      });

      const result = await response.json() as { error?: string; approver?: { name: string; role: string } };
      if (!response.ok) {
        throw new Error(result.error || 'ส่งรายการไม่สำเร็จ');
      }

      setFeedback({
        type: 'success',
        msg: isReceive
          ? `รับเข้า ${validItems.length} รายการเรียบร้อย อนุมัติโดย ${result.approver?.name || approverUsername}`
          : `เบิกจ่าย ${validItems.length} รายการเรียบร้อย อนุมัติโดย ${result.approver?.name || lineApprover?.name || approverUsername}`,
      });
      setCart([]);
      setLastAdded(null);
      setApproverPin('');
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
  const totalUnits = cart.reduce((sum, item) => sum + (item.qty > 0 ? item.qty : 0), 0);
  const sheetQty = lastAdded ? cart.find((item) => item.cartId === lastAdded.cartId)?.qty : undefined;

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ground px-6">
        <Loader2 className="animate-spin text-ink" size={40} />
        <p className="text-sm text-ink-muted">กำลังโหลดหน้าการทำงานบนมือถือ...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ground text-ink">
      <div className="mx-auto max-w-md space-y-3.5 px-[18px] pb-44">
        <div className="sticky top-0 z-20 -mx-[18px] space-y-3 bg-ground/95 px-[18px] pb-2 pt-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Link href="/mobile" aria-label="กลับหน้าหลัก" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink!">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <p className="text-xs tracking-[0.1em] text-ink-muted">สแกนก่อน</p>
              <h1 className="text-xl font-semibold">{pageTitle}</h1>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-white p-1">
            <Link
              href="/mobile/receive"
              aria-current={isReceive ? 'page' : undefined}
              className={`flex h-11 items-center justify-center rounded-xl text-sm font-medium ${isReceive ? 'bg-ink text-white!' : 'text-ink-muted!'}`}
            >
              รับเข้า
            </Link>
            <Link
              href="/mobile/dispense"
              aria-current={!isReceive ? 'page' : undefined}
              className={`flex h-11 items-center justify-center rounded-xl text-sm font-medium ${!isReceive ? 'bg-ink text-white!' : 'text-ink-muted!'}`}
            >
              เบิกจ่าย
            </Link>
          </div>
        </div>

        {feedback && (
          <div
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
              feedback.type === 'success'
                ? 'border-ok/25 bg-ok-bg text-ok'
                : 'border-crit/25 bg-crit-bg text-crit'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle size={18} className="shrink-0" /> : <XCircle size={18} className="shrink-0" />}
            <p className="flex-1 text-sm font-medium">{feedback.msg}</p>
            <button onClick={() => setFeedback(null)} className="min-h-11 px-2 text-xs font-medium">
              ปิด
            </button>
          </div>
        )}

        {loadError && (
          <div role="alert" className="rounded-2xl border border-crit/25 bg-crit-bg p-3.5 text-sm font-medium text-crit">
            {loadError}
          </div>
        )}

        <div className="space-y-3 rounded-[18px] border border-line bg-white p-3.5">
          <button
            onClick={() => {
              setLastAdded(null);
              setScanMode(true);
            }}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-ink text-base font-medium text-white active:scale-[0.99]"
          >
            <Camera size={22} />
            สแกนบาร์โค้ด
          </button>

          <form onSubmit={handleManualAdd} className="space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a8d91]" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="พิมพ์รหัส ชื่อน้ำยา หรือบาร์โค้ด..."
                className={`${fieldClass} pl-10`}
              />
              {showResults && filteredResults.length > 0 && (
                <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_32px_rgba(29,31,32,0.16)]">
                  {filteredResults.map((item) => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="min-h-12 w-full border-b border-[#ececee] px-4 py-2.5 text-left last:border-none"
                    >
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-ink-muted">รหัส: {item.itemId}</p>
                    </button>
                  ))}
                </div>
              )}
              {showResults && <div className="fixed inset-0 z-0" onClick={() => setShowResults(false)} />}
            </div>
            <button type="submit" className="h-12 w-full rounded-xl border border-line bg-white text-sm font-medium">
              เพิ่มด้วยตนเอง
            </button>
          </form>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <div>
              <p className="text-xs tracking-[0.1em] text-ink-muted">คิวรายการ</p>
              <h2 className="text-xl font-semibold">{cart.length} รายการ</h2>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  setCart([]);
                  setLastAdded(null);
                }}
                className="min-h-11 rounded-full px-3 text-[13px] font-medium text-crit"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-line bg-white/60 p-8 text-center">
              {isReceive ? <PackagePlus className="mx-auto mb-3 text-[#b8bbbf]" size={40} strokeWidth={1.5} /> : <HandHelping className="mx-auto mb-3 text-[#b8bbbf]" size={40} strokeWidth={1.5} />}
              <p className="text-sm text-ink-muted">เริ่มต้นด้วยการสแกนหรือค้นหา</p>
            </div>
          ) : (
            cart.map((item) => {
              const isFefoPick = !isReceive && item.availableLots?.[0]?.inventoryId === item.inventoryId;
              const canChangeLot = !isReceive && (item.availableLots?.length ?? 0) > 1;

              return (
                <div key={item.cartId} className="space-y-3 rounded-[18px] border border-line bg-white p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{item.name}</h3>
                      <p className="text-xs text-ink-muted">{item.itemId}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isFefoPick && <span className="rounded-full bg-ok-bg px-2.5 py-1 text-[11px] font-medium text-ok">FEFO แนะนำ</span>}
                      <button
                        onClick={() => removeFromCart(item.cartId)}
                        aria-label={`เอา ${item.name} ออกจากคิว`}
                        className="flex size-11 items-center justify-center rounded-xl text-ink-muted"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>

                  {isReceive ? (
                    <div className="grid grid-cols-1 gap-2.5">
                      <input
                        type="text"
                        value={item.lotNo}
                        onChange={(e) => updateReceiveField(item.cartId, 'lotNo', e.target.value)}
                        placeholder="เลขล็อต"
                        aria-label="เลขล็อต"
                        className={fieldClass}
                      />
                      <input
                        type="date"
                        value={item.expDate}
                        onChange={(e) => updateReceiveField(item.cartId, 'expDate', e.target.value)}
                        aria-label="วันหมดอายุ"
                        className={fieldClass}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-[10px] bg-[#f6f6f7] px-3 py-2">
                          <p className="text-[11px] text-ink-muted">ล็อต · หมดอายุ</p>
                          <p className="text-sm font-medium">{item.lotNo} · {formatThaiDate(item.expDate)}</p>
                        </div>
                        <div className="rounded-[10px] bg-[#f6f6f7] px-3 py-2">
                          <p className="text-[11px] text-ink-muted">คงเหลือในล็อต</p>
                          <p className="text-sm font-medium">{item.maxQty} {item.unit}</p>
                        </div>
                      </div>
                      {canChangeLot && (
                        <select
                          aria-label="เปลี่ยนล็อต"
                          value={String(item.inventoryId)}
                          onChange={(e) => updateDispenseLot(item.cartId, e.target.value)}
                          className={fieldClass}
                        >
                          {item.availableLots?.map((lot) => (
                            <option key={lot.inventoryId} value={String(lot.inventoryId)}>
                              {`${lot.lotNo} | EXP ${formatThaiDate(lot.expDate)} | รับเข้า ${formatThaiDate(lot.receivedOn)}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ink-muted">
                      {isReceive ? 'จำนวนที่รับเข้า' : 'จำนวนที่เบิก'} ({item.unit})
                    </p>
                    <QtyStepper
                      value={item.qty}
                      onChange={(value) => updateQty(item.cartId, String(value))}
                      max={isReceive ? undefined : item.maxQty}
                      label={`จำนวน ${item.name}`}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {lastAdded && sheetQty !== undefined && !confirmOpen && !scanMode && (
        <ScanResultSheet
          item={lastAdded}
          qty={sheetQty}
          onUndo={undoLastAdded}
          onDismiss={() => setLastAdded(null)}
          onScanNext={scanNext}
        />
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white px-[18px] pb-7 pt-3">
          <div className="mx-auto flex max-w-md items-center gap-4">
            <div>
              <p className="text-xs text-ink-muted">รวม</p>
              <p className="text-xl font-semibold">{totalUnits} หน่วย</p>
            </div>
            <button
              onClick={openConfirm}
              disabled={submitting}
              className="flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-ink font-medium text-white active:scale-[0.99] disabled:opacity-50"
            >
              {submitting ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle size={20} />}
              {isReceive ? `ยืนยันรับเข้า ${cart.length} รายการ` : `ยืนยันเบิกจ่าย ${cart.length} รายการ`}
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (!submitting) {
            setConfirmOpen(false);
            setConfirmError('');
            setApproverPin('');
          }
        }}
        title={isReceive ? 'อนุมัติรายการรับเข้า' : 'อนุมัติรายการเบิกจ่าย'}
        maxWidth="max-w-md"
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-[#f6f6f7] p-4">
            <p className="text-xs text-ink-muted">ต้องมีการอนุมัติ</p>
            <p className="mt-1.5 text-sm">
              {lineApprover ? `ยืนยันผ่าน LINE ในชื่อ ${lineApprover.name}` : `กรอกชื่อผู้ใช้และ PIN เพื่ออนุมัติรายการ${isReceive ? 'รับเข้า' : 'เบิกจ่าย'}นี้`}
            </p>
          </div>

          {!lineApprover && <><div className="space-y-1.5">
            <label htmlFor="mobile-approver-username" className="ml-1 text-xs text-ink-muted">ชื่อผู้ใช้</label>
            <input
              id="mobile-approver-username"
              type="text"
              value={approverUsername}
              onChange={(e) => setApproverUsername(e.target.value)}
              placeholder="ตัวอย่าง staff01"
              autoComplete="username"
              className={fieldClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mobile-approver-pin" className="ml-1 text-xs text-ink-muted">PIN</label>
            <input
              id="mobile-approver-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={approverPin}
              onChange={(e) => setApproverPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="4-6 หลัก"
              className={fieldClass}
            />
          </div>
          </>}

          {confirmError && (
            <div role="alert" className="rounded-2xl border border-crit/25 bg-crit-bg p-3.5 text-sm font-medium text-crit">
              {confirmError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-ink font-medium text-white disabled:opacity-50"
          >
            {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
            {lineApprover ? "ยืนยันด้วย LINE" : "ยืนยันด้วย PIN"}
          </button>
        </div>
      </Modal>

      {scanMode && (
        <QRScanner
          variant="mobile"
          title={isReceive ? 'รับเข้าคลังหลัก' : 'เบิกจ่ายหน้างาน'}
          onScan={handleScan}
          onClose={() => setScanMode(false)}
        />
      )}
    </div>
  );
}
