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
    <main className="min-h-screen overflow-hidden bg-[#f4fafb] text-[#102a2e]">
      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-7">
        <Link href="/" aria-label="LabStock หน้าแรก" className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[#0b8f8c] text-white shadow-lg shadow-[#0b8f8c]/20">
            <FlaskConical size={24} strokeWidth={1.8} />
          </span>
          <span>
            <span className="block text-xl font-black tracking-[-0.04em] text-[#102a43]">LabStock</span>
            <span className="block text-[9px] font-bold tracking-[0.18em] text-[#5d7378]">LABORATORY INVENTORY</span>
          </span>
        </Link>

        <nav aria-label="เมนูหน้าแรก" className="hidden items-center gap-8 text-sm font-semibold text-[#5d7378] lg:flex">
          <Link href="#capabilities" className="transition-colors hover:text-[#0b8f8c]">ความสามารถ</Link>
          <Link href="#workflow" className="transition-colors hover:text-[#0b8f8c]">การทำงาน</Link>
          <Link href="#trust" className="transition-colors hover:text-[#0b8f8c]">ความปลอดภัย</Link>
        </nav>

        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#102a43] px-4 text-sm font-bold text-white shadow-lg shadow-[#102a43]/15 transition hover:bg-[#173f5e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b8f8c]"
        >
          เข้าสู่ระบบ
          <ArrowUpRight size={16} />
        </Link>
      </header>

      <section className="relative mx-auto grid w-full max-w-[1440px] items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[0.86fr_1.14fr] lg:gap-14 lg:px-12 lg:pb-28 lg:pt-16">
        <div className="relative z-10 max-w-2xl">
          <p className="mb-6 inline-flex items-center gap-2 text-[11px] font-black tracking-[0.18em] text-[#0b8f8c]">
            <span className="size-2 rounded-full bg-[#0b8f8c] shadow-[0_0_0_5px_rgba(11,143,140,0.12)]" aria-hidden="true" />
            LABORATORY OPERATIONS PLATFORM
          </p>
          <h1 className="max-w-xl text-5xl font-black leading-[1.06] tracking-[-0.06em] text-[#102a43] sm:text-6xl lg:text-[clamp(3.8rem,5.8vw,6.4rem)]">
            ควบคุมน้ำยา
            <br />
            <span className="text-[#0b8f8c]">เครื่องตรวจ</span>
            <br />
            ได้อย่างมั่นใจ
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-[#5d7378] sm:text-lg">
            LabStock ช่วยให้ทีมแล็บเห็นภาพรวม reagent สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติ ตั้งแต่รับเข้า ติดตาม lot และวันหมดอายุ ไปจนถึงการเบิกใช้ที่ตรวจสอบย้อนกลับได้
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#0b8f8c] px-6 text-sm font-black text-white shadow-xl shadow-[#0b8f8c]/20 transition hover:-translate-y-0.5 hover:bg-[#087772] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102a43]"
            >
              เริ่มใช้งานระบบ
              <ArrowRight size={18} />
            </Link>
            <Link
              href="#capabilities"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-[#b9d8da] bg-white/70 px-6 text-sm font-black text-[#102a43] transition hover:border-[#0b8f8c] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b8f8c]"
            >
              ดูภาพรวมระบบ
              <ScanLine size={18} className="text-[#0b8f8c]" />
            </Link>
          </div>
          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-[#c9e1e3] pt-6">
            <div><p className="text-2xl font-black tracking-[-0.04em] text-[#102a43]">24/7</p><p className="mt-1 text-xs font-semibold leading-5 text-[#6e8589]">เห็นข้อมูลพร้อมใช้</p></div>
            <div><p className="text-2xl font-black tracking-[-0.04em] text-[#102a43]">1 view</p><p className="mt-1 text-xs font-semibold leading-5 text-[#6e8589]">ภาพรวมทุก analyzer</p></div>
            <div><p className="text-2xl font-black tracking-[-0.04em] text-[#102a43]">Trace</p><p className="mt-1 text-xs font-semibold leading-5 text-[#6e8589]">ตรวจสอบย้อนหลังได้</p></div>
          </div>
        </div>

        <div className="relative min-h-[420px] sm:min-h-[540px] lg:min-h-[650px]">
          <div className="absolute -right-20 top-8 size-72 rounded-full bg-[#35c7c1]/20 blur-3xl" aria-hidden="true" />
          <div className="relative h-full min-h-[420px] overflow-hidden rounded-[2rem] border border-white/80 bg-[#102a43] shadow-[0_30px_80px_-34px_rgba(16,42,67,0.6)] sm:min-h-[540px] lg:min-h-[650px]">
            <Image src="/images/labstock-clinical-inventory-hero.png" alt="ชั้นวางน้ำยาและอุปกรณ์สำหรับเครื่องตรวจวิเคราะห์อัตโนมัติในห้องปฏิบัติการ" fill priority sizes="(max-width: 1024px) 100vw, 58vw" className="object-cover object-center opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#071b2d] via-[#071b2d]/15 to-transparent" />
            <div className="absolute inset-x-5 top-5 flex items-center justify-between rounded-2xl border border-white/15 bg-[#0b273d]/60 px-4 py-3 text-white backdrop-blur-md sm:inset-x-7 sm:top-7">
              <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-[#35c7c1] text-[#102a43]"><FlaskConical size={17} /></span><span className="text-xs font-black tracking-[0.14em]">LABSTOCK / OVERVIEW</span></div>
              <span className="flex items-center gap-2 text-[11px] font-bold text-[#bce8e3]"><span className="size-2 rounded-full bg-[#6ee7b7]" />LIVE DATA</span>
            </div>
            <div className="absolute inset-x-5 bottom-5 grid gap-3 sm:inset-x-7 sm:bottom-7 sm:grid-cols-[1fr_0.85fr]">
              <div className="rounded-2xl border border-white/15 bg-[#071b2d]/80 p-4 text-white backdrop-blur-xl sm:p-5">
                <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold tracking-[0.14em] text-[#9fc4ca]">ANALYZER REAGENTS</p><p className="mt-2 text-3xl font-black tracking-[-0.05em]">1,245 <span className="text-sm font-semibold text-[#a9c9ce]">รายการ</span></p></div><div className="rounded-xl bg-[#0b8f8c]/25 p-2.5 text-[#74ebe4]"><Boxes size={21} /></div></div>
                <div className="mt-4 flex items-center justify-between text-[11px] font-semibold text-[#b8d4d7]"><span>stock พร้อมใช้</span><span className="text-[#76e1b5]">84.6%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[84.6%] rounded-full bg-[#35c7c1]" /></div>
              </div>
              <div className="rounded-2xl border border-[#f4b942]/30 bg-[#2f2a19]/80 p-4 text-white backdrop-blur-xl sm:p-5"><div className="flex items-center gap-2 text-[#f7d58b]"><BellRing size={17} /><span className="text-[11px] font-black tracking-[0.12em]">ACTION NEEDED</span></div><p className="mt-4 text-2xl font-black tracking-[-0.04em]">23 รายการ</p><p className="mt-1 text-xs leading-5 text-[#e8d8aa]">ใกล้หมดอายุภายใน 30 วัน</p></div>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="border-y border-[#d4e8e9] bg-white/70 px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-[1320px]"><div className="max-w-2xl"><p className="text-[11px] font-black tracking-[0.18em] text-[#0b8f8c]">BUILT FOR THE BENCH</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-[#102a43] sm:text-4xl">ข้อมูลที่ทีมแล็บต้องใช้ อยู่ใกล้มือเสมอ</h2><p className="mt-4 text-base leading-7 text-[#5d7378]">ออกแบบจากงานจริงของห้องปฏิบัติการ ให้การจัดการน้ำยาเครื่องตรวจชัดเจนตั้งแต่รายการแรกจนถึงหลักฐานรายการสุดท้าย</p></div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">{capabilities.map((capability) => { const Icon = capability.icon; return <article key={capability.label} className="rounded-3xl border border-[#c9e1e3] bg-[#f8fcfc] p-6 transition hover:-translate-y-1 hover:border-[#7dc7c7] hover:shadow-xl hover:shadow-[#0b8f8c]/10 sm:p-7"><span className="flex size-12 items-center justify-center rounded-2xl bg-[#dff4f2] text-[#0b8f8c]"><Icon size={23} /></span><p className="mt-7 text-[10px] font-black tracking-[0.16em] text-[#0b8f8c]">{capability.label}</p><h3 className="mt-3 text-xl font-black leading-snug tracking-[-0.03em] text-[#102a43]">{capability.title}</h3><p className="mt-3 text-sm leading-7 text-[#5d7378]">{capability.detail}</p></article>; })}</div>
        </div>
      </section>

      <section id="workflow" className="mx-auto grid max-w-[1320px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-12 lg:py-28"><div><p className="text-[11px] font-black tracking-[0.18em] text-[#0b8f8c]">A CLEARER ROUTINE</p><h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-[#102a43] sm:text-4xl">จาก barcode สู่ stock ที่ตรวจสอบได้</h2><p className="mt-5 max-w-xl text-base leading-8 text-[#5d7378]">ลดการค้นหาข้อมูลซ้ำและทำให้ทีมเห็นสถานะของน้ำยาเครื่องตรวจในภาษาที่ใช้ทำงานจริง</p><Link href="/login" className="mt-8 inline-flex items-center gap-2 text-sm font-black text-[#0b8f8c] hover:text-[#075e5b]">เข้าสู่ระบบเพื่อดูข้อมูล <ArrowRight size={17} /></Link></div><div className="grid gap-4 sm:grid-cols-3">{[["01", "Scan", "อ่าน barcode ของ reagent หรือกล่อง calibration"], ["02", "Verify", "ยืนยัน lot, วันหมดอายุ และเครื่องที่ใช้"], ["03", "Trace", "ดูประวัติรับเข้า เบิกใช้ และยอดคงเหลือ"]].map(([number, title, detail]) => <div key={number} className="rounded-3xl border border-[#c9e1e3] bg-white p-5 shadow-sm sm:p-6"><span className="font-mono text-xs font-bold text-[#0b8f8c]">{number}</span><h3 className="mt-8 text-lg font-black text-[#102a43]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#5d7378]">{detail}</p><CheckCircle2 className="mt-8 text-[#0b8f8c]" size={20} /></div>)}</div></section>

      <section id="trust" className="bg-[#102a43] px-5 py-16 text-white sm:px-8 lg:px-12 lg:py-20"><div className="mx-auto flex max-w-[1320px] flex-col gap-8 sm:flex-row sm:items-center sm:justify-between"><div className="max-w-2xl"><div className="flex items-center gap-3"><ShieldCheck className="text-[#6ee7e0]" size={24} /><p className="text-sm font-bold text-[#b9dddf]">ออกแบบเพื่อการทำงานที่มีหลักฐาน</p></div><h2 className="mt-4 text-2xl font-black tracking-[-0.03em] sm:text-3xl">เริ่มจากภาพรวมที่ชัดเจน แล้วค่อยลงมือในจุดที่ต้องทำ</h2></div><Link href="/login" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#35c7c1] px-5 text-sm font-black text-[#102a43] transition hover:bg-[#73e6df] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#73e6df]">เข้าสู่ระบบ LabStock <ArrowRight size={17} /></Link></div></section>

      <footer className="bg-[#071b2d] px-5 py-6 text-center text-xs font-semibold text-[#9fc4ca] sm:px-8 lg:px-12"><p>LabStock · ระบบบริหารคลังน้ำยาเครื่องตรวจวิเคราะห์อัตโนมัติ</p></footer>
    </main>
  );
}
