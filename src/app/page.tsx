import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  ScanLine,
  ShieldCheck,
} from "lucide-react";

const capabilities = [
  {
    icon: Boxes,
    label: "Inventory control",
    title: "เห็น stock น้ำยาเครื่องตรวจในภาพเดียว",
    detail: "ติดตาม reagent cartridge, calibration, control และ wash solution แยกตามเครื่องและ lot",
  },
  {
    icon: BellRing,
    label: "Expiry intelligence",
    title: "รู้ก่อนน้ำยาจะหมดอายุ",
    detail: "จัดลำดับรายการใกล้หมดอายุและรายการที่ต้องสั่งซื้อ เพื่อให้ทีมวางแผนได้ทันเวลา",
  },
  {
    icon: ClipboardCheck,
    label: "Traceable workflow",
    title: "ทุกการรับเข้าและเบิกใช้มีหลักฐาน",
    detail: "เก็บ lot, วันหมดอายุ, ผู้ทำรายการ และความเคลื่อนไหวของ stock อย่างตรวจสอบย้อนกลับได้",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-gray-50 text-gray-900">
      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-7">
        <Link href="/" aria-label="LabStock หน้าแรก" className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-lg shadow-gray-900/20">
            <FlaskConical size={24} strokeWidth={1.8} />
          </span>
          <span>
            <span className="block text-xl font-black tracking-[-0.04em] text-gray-900">LabStock</span>
            <span className="block text-[9px] font-bold tracking-[0.18em] text-gray-600">LABORATORY INVENTORY</span>
          </span>
        </Link>

        <nav aria-label="เมนูหน้าแรก" className="hidden items-center gap-8 text-sm font-semibold text-gray-600 lg:flex">
          <Link href="#capabilities" className="transition-colors hover:text-blue-700">ความสามารถ</Link>
          <Link href="#workflow" className="transition-colors hover:text-blue-700">การทำงาน</Link>
          <Link href="#trust" className="transition-colors hover:text-blue-700">ความปลอดภัย</Link>
        </nav>

        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-950 px-4 text-sm font-bold text-white shadow-lg shadow-gray-900/15 transition hover:bg-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
        >
          เข้าสู่ระบบ
          <ArrowUpRight size={16} />
        </Link>
      </header>

      <section className="relative mx-auto grid w-full max-w-[1440px] items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[0.86fr_1.14fr] lg:gap-14 lg:px-12 lg:pb-28 lg:pt-16">
        <div className="relative z-10 max-w-2xl">
          <p className="mb-6 inline-flex items-center gap-2 text-[11px] font-black tracking-[0.18em] text-blue-700">
            <span className="size-2 rounded-full bg-gray-900 shadow-[0_0_0_5px_rgba(11,143,140,0.12)]" aria-hidden="true" />
            LABORATORY OPERATIONS PLATFORM
          </p>
          <h1 className="max-w-xl text-5xl font-black leading-[1.06] tracking-[-0.06em] text-gray-900 sm:text-6xl lg:text-[clamp(3.8rem,5.8vw,6.4rem)]">
            ควบคุมน้ำยา
            <br />
            <span className="text-blue-700">เครื่องตรวจ</span>
            <br />
            ได้อย่างมั่นใจ
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-gray-600 sm:text-lg">
            LabStock ช่วยให้ทีมแล็บเห็นภาพรวม reagent สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ ตั้งแต่รับเข้า ติดตาม lot และวันหมดอายุ ไปจนถึงการเบิกใช้ที่ตรวจสอบย้อนกลับได้
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-gray-900 px-6 text-sm font-black text-white shadow-xl shadow-gray-900/20 transition hover:-translate-y-0.5 hover:bg-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800"
            >
              เริ่มใช้งานระบบ
              <ArrowRight size={18} />
            </Link>
            <Link
              href="#capabilities"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-gray-300 bg-white/70 px-6 text-sm font-black text-gray-900 transition hover:border-gray-400 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
            >
              ดูภาพรวมระบบ
              <ScanLine size={18} className="text-blue-700" />
            </Link>
          </div>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-gray-300 pt-6">
            <div><p className="text-2xl font-black tracking-[-0.04em] text-gray-900">24/7</p><p className="mt-1 text-xs font-semibold leading-5 text-gray-600">เห็นข้อมูลพร้อมใช้</p></div>
            <div><p className="text-2xl font-black tracking-[-0.04em] text-gray-900">1 view</p><p className="mt-1 text-xs font-semibold leading-5 text-gray-600">ภาพรวมทุก analyzer</p></div>
            <div><p className="text-2xl font-black tracking-[-0.04em] text-gray-900">Trace</p><p className="mt-1 text-xs font-semibold leading-5 text-gray-600">ตรวจสอบย้อนหลังได้</p></div>
          </div>
        </div>

        <div className="relative min-h-[420px] sm:min-h-[540px] lg:min-h-[650px]">
          <div className="absolute -right-20 top-8 size-72 rounded-full bg-blue-300/20 blur-3xl" aria-hidden="true" />
          <div className="relative h-full min-h-[420px] overflow-hidden rounded-[2rem] border border-white/80 bg-gray-950 shadow-[0_30px_80px_-34px_rgba(16,42,67,0.6)] sm:min-h-[540px] lg:min-h-[650px]">
            <Image src="/images/labstock-clinical-inventory-hero.png" alt="ชั้นวางน้ำยาและอุปกรณ์สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติในห้องปฏิบัติการ" fill priority sizes="(max-width: 1024px) 100vw, 58vw" className="object-cover object-center opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/15 to-transparent" />
            <div className="absolute inset-x-5 top-5 flex items-center justify-between rounded-2xl border border-white/15 bg-gray-950/60 px-4 py-3 text-white backdrop-blur-md sm:inset-x-7 sm:top-7">
              <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-blue-300 text-gray-900"><FlaskConical size={17} /></span><span className="text-xs font-black tracking-[0.14em]">LABSTOCK / OVERVIEW</span></div>
              <span className="flex items-center gap-2 text-[11px] font-bold text-gray-300"><span className="size-2 rounded-full bg-gray-400" />LIVE DATA</span>
            </div>
            <div className="absolute inset-x-5 bottom-5 grid gap-3 sm:inset-x-7 sm:bottom-7 sm:grid-cols-[1fr_0.85fr]">
              <div className="rounded-2xl border border-white/15 bg-gray-950/80 p-4 text-white backdrop-blur-xl sm:p-5">
                <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold tracking-[0.14em] text-gray-300">ANALYZER REAGENTS</p><p className="mt-2 text-3xl font-black tracking-[-0.05em]">1,245 <span className="text-sm font-semibold text-gray-300">รายการ</span></p></div><div className="rounded-xl bg-gray-900/25 p-2.5 text-blue-300"><Boxes size={21} /></div></div>
                <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-gray-300"><span>stock พร้อมใช้</span><span className="text-gray-500">84.6%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[84.6%] rounded-full bg-blue-300" /></div>
              </div>
              <div className="rounded-2xl border border-[#f4b942]/30 bg-[#2f2a19]/80 p-4 text-white backdrop-blur-xl sm:p-5"><div className="flex items-center gap-2 text-[#f7d58b]"><BellRing size={17} /><span className="text-[11px] font-black tracking-[0.12em]">ACTION NEEDED</span></div><p className="mt-4 text-2xl font-black tracking-[-0.04em]">23 รายการ</p><p className="mt-1 text-xs leading-5 text-[#e8d8aa]">ใกล้หมดอายุภายใน 30 วัน</p></div>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="border-y border-gray-300 bg-white/70 px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1320px]"><div className="max-w-2xl"><p className="text-[11px] font-black tracking-[0.18em] text-blue-700">BUILT FOR THE BENCH</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-gray-900 sm:text-4xl">ข้อมูลที่ทีมแล็บต้องใช้ อยู่ใกล้มือเสมอ</h2><p className="mt-4 text-base leading-7 text-gray-600">ออกแบบจากงานจริงของห้องปฏิบัติการ ให้การจัดการน้ำยาเครื่องตรวจชัดเจนตั้งแต่รายการแรกจนถึงหลักฐานรายการสุดท้าย</p></div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">{capabilities.map((capability) => { const Icon = capability.icon; return <article key={capability.label} className="rounded-3xl border border-gray-300 bg-gray-50 p-6 transition hover:-translate-y-1 hover:border-gray-400 hover:shadow-xl hover:shadow-gray-900/10 sm:p-7"><span className="flex size-12 items-center justify-center rounded-2xl bg-gray-100 text-blue-700"><Icon size={23} /></span><p className="mt-7 text-[10px] font-black tracking-[0.16em] text-blue-700">{capability.label}</p><h3 className="mt-3 text-xl font-black leading-snug tracking-[-0.03em] text-gray-900">{capability.title}</h3><p className="mt-3 text-sm leading-7 text-gray-600">{capability.detail}</p></article>; })}</div>
        </div>
      </section>

      <section id="workflow" className="mx-auto grid max-w-[1320px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-12 lg:py-28"><div><p className="text-[11px] font-black tracking-[0.18em] text-blue-700">A CLEARER ROUTINE</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-gray-900 sm:text-4xl">จาก barcode สู่ stock ที่ตรวจสอบได้</h2><p className="mt-5 max-w-xl text-base leading-8 text-gray-600">ลดการค้นหาข้อมูลซ้ำและทำให้ทีมเห็นสถานะของน้ำยาเครื่องตรวจในภาษาที่ใช้ทำงานจริง</p><Link href="/login" className="mt-8 inline-flex items-center gap-2 text-sm font-black text-blue-700 hover:text-gray-900">เข้าสู่ระบบเพื่อดูข้อมูล <ArrowRight size={17} /></Link></div><div className="grid gap-4 sm:grid-cols-3">{[["01", "Scan", "อ่าน barcode ของ reagent หรือกล่อง calibration"], ["02", "Verify", "ยืนยัน lot, วันหมดอายุ และเครื่องที่ใช้"], ["03", "Trace", "ดูประวัติรับเข้า เบิกใช้ และยอดคงเหลือ"]].map(([number, title, detail]) => <div key={number} className="rounded-3xl border border-gray-300 bg-white p-5 shadow-sm sm:p-6"><span className="font-mono text-xs font-bold text-blue-700">{number}</span><h3 className="mt-8 text-lg font-black text-gray-900">{title}</h3><p className="mt-2 text-sm leading-6 text-gray-600">{detail}</p><CheckCircle2 className="mt-8 text-blue-700" size={20} /></div>)}</div></section>

      <section id="trust" className="bg-gray-950 px-5 py-16 text-white sm:px-8 lg:px-12 lg:py-20"><div className="mx-auto flex max-w-[1320px] flex-col gap-8 sm:flex-row sm:items-center sm:justify-between"><div className="max-w-2xl"><div className="flex items-center gap-3"><ShieldCheck className="text-blue-300" size={24} /><p className="text-sm font-bold text-gray-300">ออกแบบเพื่อการทำงานที่มีหลักฐาน</p></div><h2 className="mt-4 text-2xl font-black tracking-[-0.03em] sm:text-3xl">เริ่มจากภาพรวมที่ชัดเจน แล้วค่อยลงมือในจุดที่ต้องทำ</h2></div><Link href="/login" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-300 px-5 text-sm font-black text-gray-900 transition hover:bg-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">เข้าสู่ระบบ LabStock <ArrowRight size={17} /></Link></div></section>

      <footer className="bg-gray-950 px-5 py-6 text-center text-xs font-semibold text-gray-300 sm:px-8 lg:px-12"><p>LabStock · ระบบบริหารคลังน้ำยาเครื่องตรวจวิเคราะห์อัตโนมัติ</p></footer>
    </main>
  );
}
