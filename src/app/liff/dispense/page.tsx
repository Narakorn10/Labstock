import Link from "next/link";
import { ArrowRight, BadgeCheck, HandHelping, Search, ShieldCheck } from "lucide-react";
import { getLineDispenseUrl } from "@/lib/line-bot";

const steps = [
  { label: "ค้นหา/สแกน", icon: Search },
  { label: "เลือก Lot", icon: BadgeCheck },
  { label: "ยืนยัน PIN", icon: ShieldCheck },
];

export default function LiffDispensePage() {
  const richMenuUrl = getLineDispenseUrl();

  return (
    <main className="min-h-screen bg-[#eef3f0] text-gray-950">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-5">
        <section className="rounded-3xl border border-emerald-900/10 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                LINE LIFF
              </p>
              <h1 className="mt-2 text-3xl font-black leading-tight text-gray-950">
                เมนูเบิกน้ำยา
              </h1>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white">
              <HandHelping size={28} />
            </div>
          </div>

          <p className="mt-4 text-sm font-medium leading-6 text-gray-600">
            เลือกรายการเบิกผ่านหน้ามือถือเดิมของ LabStock แล้วบันทึกด้วย
            username และ PIN เพื่อให้รายการเข้าระบบทันที
          </p>
        </section>

        <section className="mt-4 grid grid-cols-3 gap-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.label}
                className="rounded-2xl border border-emerald-900/10 bg-white p-3 text-center shadow-sm"
              >
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Icon size={20} />
                </div>
                <p className="mt-2 text-[11px] font-black text-gray-900">{step.label}</p>
                <p className="mt-1 text-[10px] font-bold text-gray-400">ขั้นที่ {index + 1}</p>
              </div>
            );
          })}
        </section>

        <section className="mt-4 rounded-3xl border border-emerald-900/10 bg-[#173f35] p-5 text-white shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-100">
            Ready
          </p>
          <h2 className="mt-2 text-2xl font-black">เริ่มเบิก</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-emerald-50">
            ระบบจะพาไปหน้าค้นหาน้ำยา เลือก Lot จำนวน และยืนยันรายการ
          </p>

          <Link
            href="/mobile/dispense?source=line-liff"
            className="mt-5 flex min-h-14 items-center justify-between rounded-2xl bg-white px-5 text-base font-black text-emerald-900"
          >
            <span>เปิดหน้าเบิกน้ำยา</span>
            <ArrowRight size={22} />
          </Link>
        </section>

        <section className="mt-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-black text-gray-900">ตั้งค่าใน LINE Official Account</p>
          <p className="mt-2 break-all text-xs font-medium leading-5 text-gray-500">
            ใช้ URL นี้เป็น endpoint ของ LIFF หรือ Rich Menu: {richMenuUrl}
          </p>
        </section>
      </div>
    </main>
  );
}
