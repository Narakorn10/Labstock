"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import liff from "@line/liff";
import {
  Camera,
  CheckCircle,
  HandHelping,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import PinInput from "@/components/mobile/pin-input";
import QtyStepper from "@/components/mobile/qty-stepper";
import { BarcodePattern, BarcodePatternV2Runtime, Lot, Reagent } from "@/lib/api-client";
import { findMatchingReagentWithV2 } from "@/lib/barcode-parser";
import { formatThaiDate } from "@/lib/thai-date";
import QRScanner from "@/components/lazy-qr-scanner";

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
  v2Patterns: BarcodePatternV2Runtime[];
};

const createCartId = (itemId: string) => `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PURPOSE_PRESETS = ["งานประจำวัน", "QC", "Calibrate"];

const fieldClass =
  "min-h-[50px] w-full rounded-xl border border-line bg-white px-3.5 text-base outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10";

const primaryButtonClass =
  "flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-line-green-ink px-4 font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

export default function LiffDispenseWorkflow() {
  const [idToken, setIdToken] = useState("");
  const [lineName, setLineName] = useState("");
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [linking, setLinking] = useState(false);

  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [patterns, setPatterns] = useState<BarcodePattern[]>([]);
  const [v2Patterns, setV2Patterns] = useState<BarcodePatternV2Runtime[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [cart, setCart] = useState<MobileCartItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [purpose, setPurpose] = useState("");
  const [otherPurpose, setOtherPurpose] = useState(false);
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
        // The name is only present when the LIFF app was granted the profile scope; the bind screen works without it.
        setLineName(liff.getDecodedIDToken()?.name || "");

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
      setV2Patterns(data.v2Patterns || []);
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
    // Adding the same reagent again (typed by name) fills the earliest-expiring lot first;
    // only when that cart row has reached the lot's stock does the next lot get a new row.
    const qtyInCart = (inventoryId: number) => cart.find((item) => item.inventoryId === inventoryId)?.qty ?? 0;
    let selectedLot = sortedLots.find((lot) => qtyInCart(lot.inventoryId) < lot.qty) ?? sortedLots[0];

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
    const { data, match, lookupValues } = findMatchingReagentWithV2(decodedText, patterns, v2Patterns, reagents, v2Patterns.length > 0);
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

  const choosePurposePreset = (preset: string) => {
    setOtherPurpose(false);
    setPurpose((current) => (current === preset ? "" : preset));
  };

  const chooseOtherPurpose = () => {
    if (otherPurpose) {
      setOtherPurpose(false);
      setPurpose("");
      return;
    }
    setOtherPurpose(true);
    setPurpose((current) => (PURPOSE_PRESETS.includes(current) ? "" : current));
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
      setOtherPurpose(false);
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
      <section className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-ground px-6 text-center text-ink" aria-live="polite">
        <span className="flex size-14 items-center justify-center rounded-2xl border border-line bg-white">
          <Loader2 className="animate-spin text-line-green-ink" size={28} />
        </span>
        <div>
          <p className="text-base font-semibold">กำลังเปิดการเบิกจ่าย</p>
          <p className="mt-1 text-sm text-ink-muted">กำลังยืนยันตัวตนผ่าน LINE...</p>
        </div>
      </section>
    );
  }

  if (error && !idToken) {
    return (
      <section className="flex min-h-[100dvh] items-center justify-center bg-ground px-5 text-center" role="alert">
        <div className="max-w-sm rounded-[22px] border border-line bg-white p-6">
          <XCircle className="mx-auto text-crit" size={34} />
          <h1 className="mt-4 text-xl font-semibold text-ink">เปิดหน้าการเบิกจ่ายไม่สำเร็จ</h1>
          <p className="mt-2 text-sm leading-6 text-crit">{error}</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="min-h-[100dvh] bg-ground px-[18px] py-[max(1.125rem,env(safe-area-inset-top))] text-ink" aria-label="ผูกบัญชี LINE">
        <div className="mx-auto flex min-h-[calc(100dvh-2.25rem)] max-w-md flex-col gap-3.5">
          <div className="rounded-[22px] bg-line-green-ink p-5 text-white">
            <div className="flex items-center gap-2.5">
              <Image src="/images/logo-spr-lab.png" alt="" width={40} height={40} className="size-10 rounded-[10px]" />
              <p className="text-xs tracking-[0.12em]">LABSTOCK × LINE</p>
            </div>
            <h1 className="mb-1.5 mt-3.5 text-2xl font-semibold">ผูกบัญชี LINE ครั้งแรก</h1>
            <p className="text-sm leading-relaxed text-[#e7fbef]">ยืนยันด้วย username และ PIN เพียงครั้งเดียว แล้วเริ่มเบิกจ่ายผ่าน LINE ได้ทันที</p>
          </div>

          <form
            className="flex flex-1 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void linkAccount();
            }}
          >
            <div className="space-y-3 rounded-[18px] border border-line bg-white p-4">
              {lineName && (
                <div className="flex items-center gap-2.5 border-b border-[#ececee] pb-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8e8eb] font-semibold" aria-hidden="true">
                    {Array.from(lineName)[0]}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-ink-muted">บัญชี LINE</p>
                    <p className="truncate font-semibold">{lineName}</p>
                  </div>
                </div>
              )}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Username LabStock</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="เช่น staff01"
                  className={fieldClass}
                />
              </label>
              <div className="space-y-1.5">
                <span className="block text-sm font-medium">PIN 4-6 หลัก</span>
                <PinInput value={pin} onChange={setPin} label="PIN 4-6 หลัก" disabled={linking} />
              </div>
              {error && <p className="rounded-xl border border-crit/25 bg-crit-bg p-3.5 text-sm font-medium text-crit" role="alert">{error}</p>}
            </div>

            <button type="submit" disabled={linking} className={`${primaryButtonClass} mt-auto`}>
              {linking ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
              ยืนยันและผูกบัญชี
            </button>
            <p className="text-center text-xs text-ink-muted">ผูกได้ 1 บัญชี LINE ต่อ 1 ผู้ใช้ LabStock</p>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[100dvh] bg-ground text-ink" aria-label="เบิกจ่ายน้ำยาผ่าน LINE">
      <div className="mx-auto max-w-md pb-[calc(9rem+env(safe-area-inset-bottom))]">
        <header className="space-y-3 px-4 pb-1 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-muted">{user.name || user.username} · {user.role}</p>
              <h1 className="text-[22px] font-semibold">เบิกจ่ายน้ำยา</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-[#e6f9ee] px-2.5 py-1 text-xs font-medium text-line-green-ink">ผูก LINE แล้ว</span>
              <button
                type="button"
                onClick={() => void loadLookupData()}
                disabled={lookupLoading}
                aria-label="โหลดข้อมูลน้ำยาใหม่"
                className="flex size-11 items-center justify-center rounded-full border border-line bg-white text-ink transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={17} className={lookupLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1" role="progressbar" aria-label="ความคืบหน้าการเบิกจ่าย" aria-valuemin={1} aria-valuemax={3} aria-valuenow={activeStep} aria-valuetext={`ขั้นตอนที่ ${activeStep} จาก 3`}>
            {[1, 2, 3].map((step) => (
              <span key={step} className={`h-[5px] rounded-[3px] ${activeStep >= step ? "bg-line-green" : "bg-[#d6d6d9]"}`} />
            ))}
          </div>
        </header>

        <div className="space-y-3 px-4 py-3">
          {feedback && (
            <div className={`flex items-start gap-3 rounded-2xl border p-3.5 ${feedback.type === "success" ? "border-ok/25 bg-ok-bg text-ok" : "border-crit/25 bg-crit-bg text-crit"}`} role="status" aria-live="polite">
              {feedback.type === "success" ? <CheckCircle className="mt-0.5 shrink-0" size={20} /> : <XCircle className="mt-0.5 shrink-0" size={20} />}
              <p className="min-w-0 flex-1 text-sm font-medium leading-5">{feedback.msg}</p>
              <button type="button" onClick={() => setFeedback(null)} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-medium underline underline-offset-2">ปิด</button>
            </div>
          )}

          {loadError && (
            <div className="rounded-2xl border border-crit/25 bg-crit-bg p-3.5 text-crit" role="alert">
              <p className="text-sm font-medium">{loadError}</p>
              <button type="button" onClick={() => void loadLookupData()} className="mt-3 min-h-11 rounded-xl border border-crit/25 bg-white px-4 text-sm font-medium">ลองโหลดใหม่</button>
            </div>
          )}

          <section className="rounded-[18px] border border-line bg-white p-3.5" aria-labelledby="discovery-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-line-green-ink">ขั้นตอนที่ 1</p>
                <h2 id="discovery-heading" className="font-semibold">สแกนหรือค้นหาน้ำยา</h2>
              </div>
              <span className="rounded-full bg-[#e6f9ee] px-2.5 py-1 text-[11px] font-medium text-line-green-ink">เริ่มที่บาร์โค้ด</span>
            </div>

            <div className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] gap-2">
              <button
                type="button"
                onClick={() => setScanMode(true)}
                disabled={lookupLoading}
                aria-label="สแกนบาร์โค้ด"
                className="flex h-12 items-center justify-center rounded-xl bg-line-green-ink text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Camera size={20} />
              </button>
              <form onSubmit={handleManualAdd} className="relative">
                <span className="sr-only">ค้นหาน้ำยา</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a8d91]" size={18} />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => setShowResults(true)}
                  placeholder="ค้นหาน้ำยา"
                  enterKeyHint="search"
                  className="h-12 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-base outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
                />
              </form>
            </div>

            {showResults && search.trim() && (
              <div className="mt-2 overflow-hidden rounded-xl border border-line bg-white" role="listbox" aria-label="ผลการค้นหาน้ำยา">
                {filteredResults.length > 0 ? filteredResults.map((item) => (
                  <button
                    key={item.itemId}
                    type="button"
                    onClick={() => addToCart(item)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-[#ececee] px-4 py-2.5 text-left last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">รหัส: {item.itemId}</span>
                    </span>
                    <Plus className="shrink-0 text-line-green-ink" size={20} />
                  </button>
                )) : (
                  <p className="px-4 py-4 text-sm text-ink-muted">ไม่พบรายการที่ตรงกับคำค้น</p>
                )}
              </div>
            )}

            {lookupLoading && (
              <div className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-[#f6f6f7] px-3 text-xs text-ink-muted" aria-live="polite">
                <Loader2 className="animate-spin text-line-green-ink" size={16} />
                กำลังอัปเดตรายการน้ำยา...
              </div>
            )}
          </section>

          <section className="rounded-[18px] border border-line bg-white p-3.5" aria-labelledby="selection-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-line-green-ink">ขั้นตอนที่ 2</p>
                <h2 id="selection-heading" className="font-semibold">รายการที่เลือก</h2>
                <p className="mt-0.5 text-xs text-ink-muted">{validItems.length} รายการ · {totalUnits} หน่วย</p>
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={() => setCart([])} className="min-h-11 rounded-xl px-3 text-xs font-medium text-crit underline underline-offset-2">ล้างทั้งหมด</button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="mt-3 rounded-2xl border-2 border-dashed border-line bg-[#f6f6f7] px-5 py-8 text-center">
                <HandHelping className="mx-auto text-[#b8bbbf]" size={38} strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium text-ink-muted">ยังไม่มีรายการเบิกจ่าย</p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">สแกนบาร์โค้ดหรือค้นหาน้ำยา แล้วระบบจะเลือกล็อตให้ตาม FEFO</p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {cart.map((item) => {
                  const fefoLot = item.availableLots?.[0];
                  const isFefoSelected = fefoLot?.inventoryId === item.inventoryId;
                  const canChangeLot = (item.availableLots?.length ?? 0) > 1;
                  return (
                    <article key={item.cartId} className="rounded-2xl border border-[#ececee] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
                          <p className="mt-0.5 text-xs text-ink-muted">รหัส: {item.itemId}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${isFefoSelected ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
                            {isFefoSelected ? "FEFO แนะนำ" : "เลือกล็อตอื่น"}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.cartId)}
                            aria-label={`ลบ ${item.name} ออกจากรายการ`}
                            className="flex size-11 items-center justify-center rounded-xl text-ink-muted"
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="block text-[#8a8d91]">หมดอายุ</span>
                          <span className="mt-0.5 block font-medium">{formatThaiDate(item.expDate)} · {item.lotNo}</span>
                        </div>
                        <div>
                          <span className="block text-[#8a8d91]">คงเหลือในล็อต</span>
                          <span className="mt-0.5 block font-medium">{item.maxQty} {item.unit}</span>
                        </div>
                      </div>

                      {canChangeLot && (
                        <div className="mt-3">
                          <label htmlFor={`lot-${item.cartId}`} className="mb-1 block text-xs font-medium">ล็อตที่เลือก</label>
                          <select
                            id={`lot-${item.cartId}`}
                            value={String(item.inventoryId)}
                            onChange={(event) => updateDispenseLot(item.cartId, event.target.value)}
                            className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
                          >
                            {item.availableLots?.map((lot, index) => (
                              <option key={lot.inventoryId} value={String(lot.inventoryId)}>
                                {`${index === 0 ? "FEFO · " : ""}${lot.lotNo} · ${formatThaiDate(lot.expDate)} · เหลือ ${lot.qty}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="mt-3">
                        <p className="mb-1.5 text-xs font-semibold">จำนวนที่เบิก ({item.unit})</p>
                        <QtyStepper
                          wide
                          value={item.qty}
                          onChange={(value) => updateQty(item.cartId, String(value))}
                          max={item.maxQty}
                          label={`จำนวน ${item.name}`}
                        />
                      </div>
                    </article>
                  );
                })}

                <div className="rounded-2xl border border-[#ececee] p-3">
                  <p className="text-sm font-semibold">วัตถุประสงค์การเบิก</p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">ใช้ตรวจทานในสรุปก่อนยืนยัน เช่น งานประจำวัน หรือ QC</p>
                  <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="เลือกวัตถุประสงค์">
                    {PURPOSE_PRESETS.map((preset) => {
                      const selected = !otherPurpose && purpose === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => choosePurposePreset(preset)}
                          className={`min-h-11 rounded-full border px-3.5 text-[13px] ${selected ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      aria-pressed={otherPurpose}
                      onClick={chooseOtherPurpose}
                      className={`min-h-11 rounded-full border px-3.5 text-[13px] ${otherPurpose ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}
                    >
                      อื่น ๆ
                    </button>
                  </div>
                  {otherPurpose && (
                    <textarea
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                      maxLength={120}
                      placeholder="ระบุวัตถุประสงค์"
                      aria-label="วัตถุประสงค์การเบิก"
                      className="mt-2.5 min-h-20 w-full resize-none rounded-xl border border-line bg-white p-3 text-base outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
                    />
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white px-4 pt-3 pb-[calc(1.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            <button type="button" onClick={openConfirm} disabled={submitting} className={primaryButtonClass}>
              {submitting ? <Loader2 className="animate-spin" size={21} /> : <CheckCircle size={21} />}
              ตรวจทานก่อนยืนยัน ({validItems.length} รายการ)
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-[rgba(20,22,24,0.55)] sm:items-center sm:p-6" role="presentation">
          <button type="button" aria-label="ปิดหน้าต่างยืนยัน" onClick={closeConfirm} tabIndex={-1} className="absolute inset-0 cursor-default" disabled={submitting} />
          <section className="relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-white px-[18px] pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5 sm:mx-auto sm:max-w-md sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="mx-auto mb-3 h-[5px] w-10 rounded-[3px] bg-line" aria-hidden="true" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-line-green-ink">ขั้นตอนที่ 3</p>
                <h2 id="confirm-title" className="text-[22px] font-semibold">ยืนยันการเบิกจ่าย</h2>
              </div>
              <button type="button" onClick={closeConfirm} disabled={submitting} aria-label="ปิดหน้าต่างยืนยัน" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f6f6f7] text-ink-muted disabled:opacity-50">
                <X size={20} />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2.5 rounded-[14px] bg-[#e6f9ee] px-3.5 py-3 text-[#04873b]">
                <ShieldCheck size={18} className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">ยืนยันผ่าน LINE</p>
                  <p className="truncate text-xs">{lineName ? `${lineName} ↔ ${user.username}` : `${user.name || user.username} · ${user.role}`}</p>
                </div>
              </div>

              <div className="rounded-[14px] border border-[#ececee] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">สรุปรายการ</p>
                  <span className="text-xs text-ink-muted">{validItems.length} รายการ · {totalUnits} หน่วย</span>
                </div>
                <ul className="mt-2">
                  {validItems.map((item) => (
                    <li key={item.cartId} className="flex items-start justify-between gap-3 border-t border-[#f0f0f2] py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{item.name}</span>
                        <span className="block text-xs text-ink-muted">ล็อต {item.lotNo}{item.availableLots?.[0]?.inventoryId === item.inventoryId ? " · FEFO" : ""}</span>
                      </span>
                      <span className="shrink-0 font-semibold">{item.qty} {item.unit}</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-3 border-t border-[#f0f0f2] pt-2 text-[13px] text-ink-muted">
                    <span>วัตถุประสงค์</span>
                    <span className="text-ink">{purpose.trim() || "ไม่ได้ระบุ"}</span>
                  </li>
                </ul>
              </div>

              {!idToken && (
                <div className="space-y-3 rounded-[14px] border border-line p-3.5">
                  <p className="text-sm font-semibold">ยืนยันด้วยบัญชี LabStock</p>
                  <input value={approverUsername} onChange={(event) => setApproverUsername(event.target.value)} placeholder="Username" autoComplete="username" aria-label="Username" className={fieldClass} />
                  <PinInput value={approverPin} onChange={setApproverPin} label="PIN 4-6 หลัก" autoComplete="one-time-code" />
                </div>
              )}

              {confirmError && <p className="rounded-xl border border-crit/25 bg-crit-bg p-3.5 text-sm font-medium text-crit" role="alert">{confirmError}</p>}

              <div className="grid grid-cols-[1fr_1.6fr] gap-2.5">
                <button type="button" onClick={closeConfirm} disabled={submitting} className="min-h-[54px] rounded-[14px] border border-line bg-white font-medium disabled:opacity-50">
                  แก้ไข
                </button>
                <button type="button" onClick={handleSubmit} disabled={submitting} className={primaryButtonClass}>
                  {submitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                  ยืนยันเบิกจ่าย
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {scanMode && <QRScanner variant="mobile" title="เบิกจ่ายน้ำยา" onScan={handleScan} onClose={() => setScanMode(false)} />}
    </section>
  );
}
