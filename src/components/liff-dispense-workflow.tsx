"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import {
  Calendar,
  Camera,
  CheckCircle,
  HandHelping,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { BarcodePattern, Lot, Reagent } from "@/lib/api-client";
import { findMatchingReagent } from "@/lib/barcode-parser";
import QRScanner from "@/components/qr-scanner";

type LinkedUser = { username: string; name: string; role: string };

type MobileCartItem = {
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
};

type MobileLookupResponse = {
  reagents: Reagent[];
  patterns: BarcodePattern[];
};

const createCartId = (itemId: string) => `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formatThaiDate(value?: string) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function LiffDispenseWorkflow() {
  const [idToken, setIdToken] = useState("");
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [linking, setLinking] = useState(false);

  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [cart, setCart] = useState<MobileCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [purpose, setPurpose] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approverUsername, setApproverUsername] = useState("");
  const [approverPin, setApproverPin] = useState("");
  const [confirmError, setConfirmError] = useState("");

  useEffect(() => {
    const initialize = async () => {
      const liffId = process.env.NEXT_PUBLIC_LINE_DISPENSE_LIFF_ID?.trim();
      if (!liffId) {
        setError("ยังไม่ได้ตั้งค่า LINE LIFF ID ในระบบ");
        setLoading(false);
        return;
      }

      try {
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        const token = liff.getIDToken();
        if (!token) throw new Error("ไม่พบข้อมูลยืนยันตัวตนจาก LINE");
        setIdToken(token);

        const response = await fetch("/api/mobile/line-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        });
        const result = await response.json() as { linked?: boolean; user?: LinkedUser; error?: string };
        if (!response.ok) throw new Error(result.error || "ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ");
        if (result.linked && result.user) setUser(result.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ไม่สามารถเปิดการยืนยันตัวตน LINE ได้");
      } finally {
        setLoading(false);
      }
    };

    void initialize();
  }, []);

  const linkAccount = async () => {
    if (!username.trim() || !pin.trim()) {
      setError("กรอก username และ PIN เพื่อผูกบัญชีครั้งแรก");
      return;
    }

    setLinking(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/line-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, username: username.trim(), pin: pin.trim() }),
      });
      const result = await response.json() as { user?: LinkedUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || "ผูกบัญชี LINE ไม่สำเร็จ");
      setUser(result.user);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ผูกบัญชี LINE ไม่สำเร็จ");
    } finally {
      setLinking(false);
    }
  };

  const loadLookupData = useCallback(async () => {
    setLookupLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/mobile/lookup");
      const data = await response.json() as MobileLookupResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "ไม่สามารถโหลดข้อมูลหน้า mobile ได้");
      }

      setReagents(data.reagents);
      setPatterns(data.patterns);
    } catch (err: unknown) {
      console.error(err);
      const lookupError = err as { message?: string };
      setLoadError(lookupError.message || "ไม่สามารถโหลดข้อมูลหน้า mobile ได้");
    } finally {
      setLookupLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void Promise.resolve().then(loadLookupData);
    }
  }, [loadLookupData, user]);

  const filteredResults = useMemo(() => {
    if (!search.trim()) return [];

    return reagents
      .filter((reagent) =>
        reagent.name.toLowerCase().includes(search.toLowerCase()) ||
        reagent.itemId.toLowerCase().includes(search.toLowerCase()) ||
        (reagent.qrCode || "").toLowerCase().includes(search.toLowerCase())
      )
      .slice(0, 6);
  }, [reagents, search]);

  const addDispenseItem = (match: Reagent, lotOverride?: string) => {
    if (match.lots.length === 0) {
      setFeedback({ type: "error", msg: `ไม่พบสต็อกที่พร้อมใช้งานสำหรับ ${match.name}` });
      return;
    }

    const sortedLots = [...match.lots].sort(
      (a, b) => new Date(a.expDate).getTime() - new Date(b.expDate).getTime()
    );
    let selectedLot = sortedLots[0];

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

    setCart((current) => {
      const existing = current.find((item) => item.inventoryId === newItem.inventoryId);
      if (existing) {
        return current.map((item) =>
          item.cartId === existing.cartId
            ? { ...item, qty: Math.min(item.qty + 1, item.maxQty || item.qty + 1) }
            : item
        );
      }
      return [newItem, ...current];
    });

    setFeedback({ type: "success", msg: `เพิ่ม ${match.name} (ล็อต ${selectedLot.lotNo}) เข้าสู่คิวเบิกจ่ายแล้ว` });
  };

  const addToCart = (match: Reagent, lotNo?: string) => {
    addDispenseItem(match, lotNo);
    setSearch("");
    setShowResults(false);
  };

  const handleScan = (decodedText: string) => {
    const { data, match, lookupValues } = findMatchingReagent(decodedText, patterns, reagents);
    if (!data) {
      setFeedback({ type: "error", msg: "ไม่สามารถอ่านบาร์โค้ดนี้ได้" });
      setScanMode(false);
      return;
    }

    if (!match) {
      const parsedId = data.gtin || data.rawString || "-";
      const parsedLot = data.lot === "NEED_MANUAL_INPUT" ? "-" : data.lot;
      setFeedback({
        type: "error",
        msg: `ไม่พบข้อมูลน้ำยาในระบบ | รหัส: ${parsedId} | ล็อต: ${parsedLot} | คำค้น: ${lookupValues.join(", ") || "-"}`,
      });
      setScanMode(false);
      return;
    }

    addToCart(
      match,
      data.lot === "NEED_MANUAL_INPUT" ? "" : data.lot
    );
    setScanMode(false);
  };

  const handleManualAdd = (event: FormEvent) => {
    event.preventDefault();
    if (filteredResults.length === 1) {
      addToCart(filteredResults[0]);
    } else {
      handleScan(search);
    }
  };

  const removeFromCart = (cartId: string) => {
    setCart((current) => current.filter((item) => item.cartId !== cartId));
  };

  const updateQty = (cartId: string, newQty: string) => {
    const parsedQty = parseInt(newQty, 10) || 0;
    setCart((current) =>
      current.map((item) => {
        if (item.cartId !== cartId) return item;
        return { ...item, qty: Math.min(parsedQty, item.maxQty || parsedQty) };
      })
    );
  };

  const updateDispenseLot = (cartId: string, selectedInventoryId: string) => {
    setCart((current) => {
      const currentItem = current.find((item) => item.cartId === cartId);
      if (!currentItem?.availableLots) return current;

      const selectedLot = currentItem.availableLots.find((lot) => String(lot.inventoryId) === selectedInventoryId);
      if (!selectedLot) return current;

      const duplicateItem = current.find(
        (item) => item.cartId !== cartId && item.inventoryId === selectedLot.inventoryId
      );

      if (duplicateItem) {
        return current
          .filter((item) => item.cartId !== cartId)
          .map((item) =>
            item.cartId === duplicateItem.cartId
              ? { ...item, qty: Math.min(item.qty + currentItem.qty, item.maxQty || item.qty + currentItem.qty) }
              : item
          );
      }

      return current.map((item) =>
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
      setFeedback({ type: "error", msg: "กรุณาระบุจำนวนที่มากกว่า 0" });
      return;
    }

    setConfirmError("");
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (submitting) return;
    setConfirmOpen(false);
    setConfirmError("");
    setApproverPin("");
  };

  const handleSubmit = async () => {
    const validItems = cart.filter((item) => item.qty > 0);

    if (validItems.length === 0) {
      setConfirmError("กรุณาระบุจำนวนที่มากกว่า 0");
      return;
    }

    if (!idToken && (!approverUsername.trim() || !approverPin.trim())) {
      setConfirmError("กรุณากรอกชื่อผู้ใช้และ PIN");
      return;
    }

    setSubmitting(true);
    setConfirmError("");

    try {
      const response = await fetch("/api/mobile/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "dispense",
          username: approverUsername.trim(),
          pin: approverPin.trim(),
          lineIdToken: idToken,
          batchItems: validItems,
        }),
      });

      const result = await response.json() as { error?: string; approver?: { name: string; role: string } };
      if (!response.ok) {
        throw new Error(result.error || "ส่งรายการไม่สำเร็จ");
      }

      setFeedback({
        type: "success",
        msg: `เบิกจ่าย ${validItems.length} รายการเรียบร้อย อนุมัติโดย ${result.approver?.name || user?.name || approverUsername}`,
      });
      setCart([]);
      setApproverPin("");
      setPurpose("");
      setConfirmOpen(false);
      await loadLookupData();
    } catch (err: unknown) {
      const submitError = err as { message?: string };
      setConfirmError(submitError.message || "ส่งรายการไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const validItems = cart.filter((item) => item.qty > 0);
  const totalUnits = validItems.reduce((total, item) => total + item.qty, 0);
  const activeStep = confirmOpen ? 3 : cart.length > 0 ? 2 : 1;

  if (loading) {
    return (
      <section className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#edf5f1] px-6 text-center text-slate-700" aria-live="polite">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <Loader2 className="animate-spin text-emerald-700" size={28} />
        </span>
        <div>
          <p className="text-base font-black">กำลังเปิดการเบิกจ่าย</p>
          <p className="mt-1 text-sm font-medium text-slate-500">กำลังยืนยันตัวตนผ่าน LINE...</p>
        </div>
      </section>
    );
  }

  if (error && !idToken) {
    return (
      <section className="flex min-h-[100dvh] items-center justify-center bg-[#edf5f1] px-5 text-center" role="alert">
        <div className="max-w-sm rounded-[28px] border border-red-100 bg-white p-6 shadow-sm">
          <XCircle className="mx-auto text-red-600" size={34} />
          <h1 className="mt-4 text-xl font-black text-slate-950">เปิดหน้าการเบิกจ่ายไม่สำเร็จ</h1>
          <p className="mt-2 text-sm font-medium leading-6 text-red-700">{error}</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="min-h-[100dvh] bg-[#edf5f1] px-4 py-[max(1.5rem,env(safe-area-inset-top))] text-slate-950" aria-label="ผูกบัญชี LINE">
        <section className="mx-auto max-w-md overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-xl shadow-emerald-950/5">
          <div className="bg-[#0b2b26] px-5 py-5 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-300 text-[#0b2b26]">
              <ShieldCheck size={25} />
            </div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-emerald-200">LabStock LIFF</p>
            <h1 className="mt-1 text-2xl font-black">ผูกบัญชี LINE ครั้งแรก</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-50/80">ยืนยันด้วย username และ PIN เพียงครั้งเดียว แล้วเริ่มเบิกจ่ายผ่าน LINE ได้ทันที</p>
          </div>

          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void linkAccount();
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs font-black text-slate-600">Username LabStock</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="เช่น staff01"
                className="min-h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-black text-slate-600">PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="PIN 4-6 หลัก"
                className="min-h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
              />
            </label>
            {error && <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</p>}
            <button type="submit" disabled={linking} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 text-base font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {linking ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
              ยืนยันและผูกบัญชี
            </button>
          </form>
        </section>
      </section>
    );
  }

  return (
    <section className="min-h-[100dvh] bg-[#edf5f1] text-slate-950" aria-label="เบิกจ่ายน้ำยาผ่าน LINE">
      <div className="mx-auto max-w-md pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
        <header className="sticky top-0 z-30 border-b border-emerald-950/20 bg-[#0b2b26]/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">LabStock · LIFF</p>
              <h1 className="mt-1 text-xl font-black tracking-tight">เบิกจ่ายน้ำยา</h1>
              <p className="mt-1 truncate text-xs font-medium text-emerald-50/75">{user.name || user.username} · {user.role}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadLookupData()}
              disabled={lookupLoading}
              aria-label="โหลดข้อมูลน้ำยาใหม่"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={18} className={lookupLoading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2" aria-label="ความคืบหน้าการเบิกจ่าย">
            {[
              { step: 1, label: "เลือกน้ำยา" },
              { step: 2, label: "ตรวจล็อต" },
              { step: 3, label: "ยืนยัน" },
            ].map((item) => {
              const isCurrent = activeStep === item.step;
              const isComplete = activeStep > item.step;
              return (
                <div key={item.step} className={`min-h-11 rounded-xl px-2 py-2 text-center ${isCurrent ? "bg-emerald-300 text-[#0b2b26]" : isComplete ? "bg-white/15 text-white" : "bg-white/5 text-emerald-50/60"}`}>
                  <span className="text-[10px] font-black">{item.step}. {item.label}</span>
                </div>
              );
            })}
          </div>
        </header>

        <div className="space-y-4 px-4 py-4">
          {feedback && (
            <div className={`flex items-start gap-3 rounded-2xl border p-4 ${feedback.type === "success" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-700"}`} role="status" aria-live="polite">
              {feedback.type === "success" ? <CheckCircle className="mt-0.5 shrink-0" size={20} /> : <XCircle className="mt-0.5 shrink-0" size={20} />}
              <p className="min-w-0 flex-1 text-sm font-bold leading-5">{feedback.msg}</p>
              <button type="button" onClick={() => setFeedback(null)} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-black underline underline-offset-2">ปิด</button>
            </div>
          )}

          {loadError && (
            <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700" role="alert">
              <p className="text-sm font-bold">{loadError}</p>
              <button type="button" onClick={() => void loadLookupData()} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-black">ลองโหลดใหม่</button>
            </div>
          )}

          <section className="rounded-[26px] border border-emerald-100 bg-white p-4 shadow-sm shadow-emerald-950/5" aria-labelledby="discovery-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">ขั้นตอนที่ 1</p>
                <h2 id="discovery-heading" className="mt-1 text-base font-black">สแกนหรือค้นหาน้ำยา</h2>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-800">เริ่มที่บาร์โค้ด</span>
            </div>

            <button
              type="button"
              onClick={() => setScanMode(true)}
              disabled={lookupLoading}
              className="mt-4 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-4 text-base font-black text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Camera size={22} />
              สแกนบาร์โค้ด
            </button>

            <form onSubmit={handleManualAdd} className="mt-3 space-y-3">
              <label className="relative block">
                <span className="sr-only">ค้นหาน้ำยา</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => setShowResults(true)}
                  placeholder="รหัส ชื่อน้ำยา หรือบาร์โค้ด"
                  className="min-h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-base font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                />
              </label>

              {showResults && search.trim() && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" role="listbox" aria-label="ผลการค้นหาน้ำยา">
                  {filteredResults.length > 0 ? filteredResults.map((item) => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-emerald-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-slate-950">{item.name}</span>
                        <span className="mt-0.5 block text-[11px] font-bold text-slate-500">รหัส: {item.itemId}</span>
                      </span>
                      <Plus className="shrink-0 text-emerald-700" size={20} />
                    </button>
                  )) : (
                    <p className="px-4 py-4 text-sm font-bold text-slate-500">ไม่พบรายการที่ตรงกับคำค้น</p>
                  )}
                </div>
              )}

              <button type="submit" disabled={lookupLoading} className="min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                เพิ่มด้วยรหัส/บาร์โค้ดที่พิมพ์
              </button>
            </form>

            {lookupLoading && (
              <div className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 text-xs font-bold text-slate-600" aria-live="polite">
                <Loader2 className="animate-spin text-emerald-700" size={16} />
                กำลังอัปเดตรายการน้ำยา...
              </div>
            )}
          </section>

          <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm shadow-emerald-950/5" aria-labelledby="selection-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">ขั้นตอนที่ 2</p>
                <h2 id="selection-heading" className="mt-1 text-base font-black">รายการที่เลือก</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">{validItems.length} รายการ · {totalUnits} หน่วย</p>
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])} className="min-h-11 rounded-xl px-3 text-xs font-black text-red-700 underline underline-offset-2">ล้างทั้งหมด</button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
                <HandHelping className="mx-auto text-slate-300" size={38} />
                <p className="mt-3 text-sm font-black text-slate-600">ยังไม่มีรายการเบิกจ่าย</p>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-500">สแกนบาร์โค้ดหรือค้นหาน้ำยา แล้วระบบจะเลือกล็อตให้ตาม FEFO</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {cart.map((item) => {
                  const fefoLot = item.availableLots?.[0];
                  const isFefoSelected = fefoLot?.inventoryId === item.inventoryId;
                  return (
                    <article key={item.cartId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black text-slate-950">{item.name}</h3>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">รหัส: {item.itemId}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.cartId)}
                          aria-label={`ลบ ${item.name} ออกจากรายการ`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label htmlFor={`lot-${item.cartId}`} className="text-xs font-black text-slate-700">ล็อตที่เลือก</label>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${isFefoSelected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            {isFefoSelected ? "FEFO แนะนำ" : "เลือกล็อตอื่น"}
                          </span>
                        </div>
                        <select
                          id={`lot-${item.cartId}`}
                          value={String(item.inventoryId)}
                          onChange={(event) => updateDispenseLot(item.cartId, event.target.value)}
                          className="min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                        >
                          {item.availableLots?.map((lot, index) => (
                            <option key={lot.inventoryId} value={String(lot.inventoryId)}>
                              {`${index === 0 ? "FEFO · " : ""}${lot.lotNo} · EXP ${formatThaiDate(lot.expDate)} · คงเหลือ ${lot.qty}`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-white p-3 text-slate-600">
                          <span className="block font-bold text-slate-400">หมดอายุ</span>
                          <span className="mt-1 flex items-center gap-1.5 font-black text-slate-800"><Calendar size={14} />{formatThaiDate(item.expDate)}</span>
                        </div>
                        <div className="rounded-xl bg-white p-3 text-slate-600">
                          <span className="block font-bold text-slate-400">คงเหลือในล็อต</span>
                          <span className="mt-1 block font-black text-slate-800">{item.maxQty} {item.unit}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs font-black text-slate-700">จำนวนที่เบิก</p>
                        <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_auto] items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateQty(item.cartId, String(Math.max(0, item.qty - 1)))}
                            aria-label={`ลดจำนวน ${item.name}`}
                            className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"
                          >
                            <Minus size={18} />
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max={item.maxQty}
                            value={item.qty}
                            onChange={(event) => updateQty(item.cartId, event.target.value)}
                            aria-label={`จำนวน ${item.name}`}
                            className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-2 text-center text-lg font-black text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                          />
                          <button
                            type="button"
                            onClick={() => updateQty(item.cartId, String(item.qty + 1))}
                            aria-label={`เพิ่มจำนวน ${item.name}`}
                            className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-700 text-white transition hover:bg-emerald-800"
                          >
                            <Plus size={18} />
                          </button>
                          <span className="min-w-10 text-right text-xs font-black text-slate-600">{item.unit}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}

                <label className="block rounded-2xl border border-slate-200 bg-white p-4">
                  <span className="text-sm font-black text-slate-900">วัตถุประสงค์การเบิก</span>
                  <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">ใช้ตรวจทานในสรุปก่อนยืนยัน เช่น งานประจำวัน หรือ QC</span>
                  <textarea
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                    maxLength={120}
                    placeholder="ระบุวัตถุประสงค์ (ไม่บังคับ)"
                    className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                  />
                </label>
              </div>
            )}
          </section>
        </div>
      </div>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-100 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_28px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mx-auto max-w-md">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <p className="text-xs font-bold text-slate-600">พร้อมตรวจสอบ <span className="font-black text-slate-950">{validItems.length} รายการ · {totalUnits} หน่วย</span></p>
              {purpose.trim() && <p className="max-w-32 truncate text-right text-[11px] font-bold text-slate-500">{purpose.trim()}</p>}
            </div>
            <button
              type="button"
              onClick={openConfirm}
              disabled={submitting}
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#0b2b26] px-4 text-base font-black text-white shadow-lg shadow-emerald-950/15 transition hover:bg-[#123a33] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 className="animate-spin" size={21} /> : <CheckCircle size={21} />}
              ตรวจสอบก่อนยืนยันเบิกจ่าย
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/55 p-3 sm:items-center sm:p-6" role="presentation">
          <button type="button" aria-label="ปิดหน้าต่างยืนยัน" onClick={closeConfirm} tabIndex={-1} className="absolute inset-0 cursor-default" disabled={submitting} />
          <section className="relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-[28px] bg-white shadow-2xl sm:mx-auto sm:max-w-md" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">ขั้นตอนที่ 3</p>
                <h2 id="confirm-title" className="mt-1 text-xl font-black text-slate-950">ยืนยันการเบิกจ่าย</h2>
              </div>
              <button type="button" onClick={closeConfirm} disabled={submitting} aria-label="ปิดหน้าต่างยืนยัน" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 disabled:opacity-50">
                <X size={22} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-900"><ShieldCheck size={18} /><p className="text-sm font-black">ยืนยันผ่าน LINE</p></div>
                <p className="mt-1 text-sm font-medium text-emerald-800">ผู้อนุมัติ: {user.name || user.username} · {user.role}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-slate-950">สรุปรายการ</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700">{validItems.length} รายการ · {totalUnits} หน่วย</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {validItems.map((item) => (
                    <li key={item.cartId} className="flex items-start justify-between gap-3 border-t border-slate-200 pt-2 text-sm">
                      <span className="min-w-0"><span className="block truncate font-black text-slate-900">{item.name}</span><span className="block text-xs font-bold text-slate-500">ล็อต {item.lotNo}{item.availableLots?.[0]?.inventoryId === item.inventoryId ? " · FEFO" : ""}</span></span>
                      <span className="shrink-0 font-black text-slate-900">{item.qty} {item.unit}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-slate-200 pt-3 text-sm">
                  <p className="font-bold text-slate-500">วัตถุประสงค์</p>
                  <p className="mt-1 font-black text-slate-900">{purpose.trim() || "ไม่ได้ระบุ"}</p>
                </div>
              </div>

              {!idToken && (
                <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-black text-slate-900">ยืนยันด้วยบัญชี LabStock</p>
                  <input value={approverUsername} onChange={(event) => setApproverUsername(event.target.value)} placeholder="Username" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20" />
                  <input type="password" inputMode="numeric" value={approverPin} onChange={(event) => setApproverPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="PIN 4-6 หลัก" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20" />
                </div>
              )}

              {confirmError && <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{confirmError}</p>}

              <button type="button" onClick={handleSubmit} disabled={submitting} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-4 text-base font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? <Loader2 className="animate-spin" size={21} /> : <CheckCircle size={21} />}
                ยืนยันเบิกจ่ายด้วย LINE
              </button>
            </div>
          </section>
        </div>
      )}

      {scanMode && <QRScanner onScan={handleScan} onClose={() => setScanMode(false)} />}
    </section>
  );
}
