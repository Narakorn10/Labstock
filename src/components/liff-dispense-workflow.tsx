"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";
import { CheckCircle, Loader2, ShieldCheck } from "lucide-react";
import MobileStockWorkflow from "@/components/mobile-stock-workflow";

type LinkedUser = { username: string; name: string; role: string };

export default function LiffDispenseWorkflow() {
  const [idToken, setIdToken] = useState("");
  const [user, setUser] = useState<LinkedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [linking, setLinking] = useState(false);

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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center gap-3 px-6 text-sm font-bold text-gray-600"><Loader2 className="animate-spin text-emerald-700" size={24} />กำลังยืนยันตัวตนผ่าน LINE...</div>;
  }

  if (error && !idToken) {
    return <div className="min-h-screen flex items-center justify-center px-6 text-center text-sm font-bold text-red-700">{error}</div>;
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#eef3f0] px-4 py-6 text-gray-950">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
          <ShieldCheck className="text-emerald-700" size={34} />
          <h1 className="mt-4 text-2xl font-black">ผูกบัญชี LINE ครั้งแรก</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">ยืนยันด้วย username และ PIN เพียงครั้งเดียว หลังจากนี้เบิกผ่าน LINE ได้โดยไม่ต้องกรอกรหัสอีก</p>
          <div className="mt-6 space-y-4">
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username LabStock" className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600" />
            <input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="PIN 4-6 หลัก" className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600" />
            {error && <p className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
            <button type="button" onClick={linkAccount} disabled={linking} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 py-4 text-sm font-black text-white disabled:opacity-50">
              {linking ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
              ยืนยันและผูกบัญชี
            </button>
          </div>
        </section>
      </main>
    );
  }

  return <MobileStockWorkflow mode="dispense" lineApprover={user} lineIdToken={idToken} />;
}
