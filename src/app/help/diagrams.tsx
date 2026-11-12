import type { ReactNode } from 'react';

/**
 * Diagram และภาพประกอบของคู่มือ
 * - diagram วาดด้วย HTML/CSS (ไม่ใช่ไฟล์ภาพ) จึงคมชัดตอนพิมพ์ PDF และอ่านได้ด้วยโปรแกรมอ่านหน้าจอ
 * - ทุกกล่อง/ลูกศรมีที่มาในโค้ด ดู docs/user-manual-sources.md หัวข้อ "diagram"
 */

/** ภาพหน้าจอจากระบบทดลองที่ใช้ข้อมูลสมมติ: ไฟล์อยู่ใน public/help/ (เทสต์ตรวจว่าไฟล์มีจริง) */
export function Figure({ src, alt, caption, narrow = false }: { src: string; alt: string; caption: ReactNode; narrow?: boolean }) {
  return (
    <figure className="manual-figure space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot; plain <img> prints reliably */}
      <img src={src} alt={alt} loading="lazy" className={`mx-auto block h-auto w-full rounded-xl border border-line ${narrow ? 'max-w-sm' : 'max-w-4xl'}`} />
      <figcaption className="text-center text-sm text-gray-600">{caption}</figcaption>
    </figure>
  );
}

type Stage = { title: string; detail: string; page: string; effect: string };

const LIFECYCLE: Stage[] = [
  { title: 'สั่งซื้อ', detail: 'สร้างใบสั่งน้ำยา ส่งให้บริษัทผู้ขาย', page: 'ใบสั่งน้ำยา', effect: 'ยอดคลังยังไม่เปลี่ยน' },
  { title: 'รับเข้า', detail: 'บันทึกน้ำยาที่มาถึง พร้อม Lot และวันหมดอายุ', page: 'Receive (รับเข้า)', effect: 'ยอดคลังเพิ่ม' },
  { title: 'เบิกใช้', detail: 'เบิกไปหน้างาน ระบบตัด Lot ที่หมดอายุก่อนให้ก่อน', page: 'Dispense (เบิกจ่าย)', effect: 'ยอดคลังลด' },
  { title: 'ติดตาม', detail: 'ดูยอดคงเหลือ ของต่ำกว่าจุดสั่งซื้อ และของใกล้หมดอายุ', page: 'Inventory Overview', effect: 'ใช้ตัดสินใจสั่งซื้อรอบถัดไป' },
];

function Arrow() {
  return (
    <span aria-hidden="true" className="manual-arrow flex items-center justify-center text-2xl text-gray-400">
      <span className="hidden sm:inline">→</span>
      <span className="sm:hidden">↓</span>
    </span>
  );
}

type FlowStep = { who: string; action: string; status: string };

/** ทางหลักของใบสั่งน้ำยาที่แล็บสร้าง (ชื่อสถานะตรงกับป้ายในหน้า "ใบสั่งน้ำยา") */
const PO_MAIN: FlowStep[] = [
  { who: 'Admin / Manager', action: 'สร้างใบสั่งน้ำยา', status: 'รอหัวหน้าตรวจสอบก่อนส่งบริษัท' },
  { who: 'Admin / Manager (หัวหน้า)', action: 'ยืนยันและส่งให้บริษัท', status: 'ส่งให้บริษัทแล้ว' },
  { who: 'บริษัท', action: 'รับทราบรายการ', status: 'บริษัทรับทราบแล้ว' },
  { who: 'บริษัท', action: 'ยืนยันจัดได้', status: 'ยืนยันแล้ว' },
  { who: 'Admin / Manager', action: 'ยืนยันรับของ (ติ๊กรายการที่มาถึง)', status: 'รับเข้าแล้วบางส่วน → รับเข้าคลังแล้ว' },
];

/** ทางแยกที่เกิดขึ้นได้ */
const PO_BRANCHES: { from: string; text: string }[] = [
  { from: 'รอหัวหน้าตรวจสอบ', text: 'หัวหน้ากด “ไม่อนุมัติ” (ต้องใส่เหตุผล) → ปฏิเสธ' },
  { from: 'ส่งให้บริษัทแล้ว / บริษัทรับทราบแล้ว', text: 'บริษัทกด “แก้ไขแล้วส่ง Lab” → บริษัทแก้ไข รอแล็บยืนยัน → แล็บกด “ยืนยัน” (→ ยืนยันแล้ว) หรือ “ปฏิเสธ”' },
  { from: 'ส่งให้บริษัทแล้ว / บริษัทรับทราบแล้ว', text: 'บริษัทกด “ปฏิเสธ” (ต้องใส่เหตุผล) → ปฏิเสธ' },
  { from: 'ส่งแล้ว ถึง ยืนยันแล้ว', text: 'แล็บกด “ยกเลิกใบสั่ง” (ต้องใส่เหตุผล) → ยกเลิกแล้ว' },
  { from: 'รับเข้าแล้วบางส่วน', text: 'แล็บกด “ปิดใบ ไม่รอรับส่วนที่เหลือ” → ปิดใบ (ได้รับไม่ครบ)' },
  { from: 'บริษัทเป็นผู้เสนอรายการ', text: 'ใบเริ่มที่ “รอแล็บตรวจสอบ” → แล็บกด “ยืนยัน” หรือ “ปฏิเสธ”' },
];

/** สถานะใบสั่งน้ำยา: ใครทำอะไร แล้วสถานะเปลี่ยนเป็นอะไร */
export function PurchaseOrderFlowDiagram() {
  return (
    <figure className="manual-figure manual-diagram space-y-3" aria-label="แผนภาพสถานะใบสั่งน้ำยา">
      <ol className="space-y-2">
        {PO_MAIN.map((step, index) => (
          <li key={step.action} className="manual-stage flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-ink bg-white p-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-white">{index + 1}</span>
            <span className="text-xs text-gray-500">{step.who}</span>
            <strong className="font-semibold text-ink">{step.action}</strong>
            <span aria-hidden="true" className="text-gray-400">→</span>
            <span className="rounded-md bg-gray-100 px-2 py-1 text-sm font-medium text-gray-800">{step.status}</span>
          </li>
        ))}
      </ol>
      <p className="manual-loop rounded-xl border-2 border-dashed border-gray-400 px-4 py-2 text-sm text-gray-700">
        <strong>ยอดคลังยังไม่เพิ่ม</strong> ในทุกขั้นตอนข้างบน — ต้องไปบันทึกที่หน้า <strong>Receive (รับเข้า)</strong> อีกครั้งเมื่อของมาถึงจริง
      </p>
      <div className="rounded-xl border-2 border-dashed border-gray-400 p-3">
        <p className="mb-1.5 text-sm font-semibold text-ink">ทางแยกที่เกิดขึ้นได้</p>
        <ul className="space-y-1.5 text-sm text-gray-700">
          {PO_BRANCHES.map((branch) => (
            <li key={branch.text}><span className="text-gray-500">เมื่อ “{branch.from}”:</span> {branch.text}</li>
          ))}
        </ul>
      </div>
      <figcaption className="text-sm text-gray-600">สถานะใบสั่งน้ำยาตั้งแต่สร้างจนรับของครบ (ชื่อสถานะตรงกับป้ายสีในหน้า “ใบสั่งน้ำยา”)</figcaption>
    </figure>
  );
}

/** วงจรน้ำยา: สั่งซื้อ → รับเข้า → เบิกใช้ → ติดตาม แล้ววนกลับไปสั่งซื้อ */
export function LifecycleDiagram() {
  return (
    <figure className="manual-figure manual-diagram space-y-3" aria-label="แผนภาพวงจรน้ำยา">
      <div className="manual-diagram-row grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        {LIFECYCLE.map((stage, index) => (
          <div key={stage.title} className="contents">
            {index > 0 && <Arrow />}
            <div className="manual-stage flex flex-col gap-1.5 rounded-xl border-2 border-ink bg-white p-3">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs text-white">{index + 1}</span>
                {stage.title}
              </p>
              <p className="text-sm leading-6 text-gray-700">{stage.detail}</p>
              <p className="mt-auto text-xs text-gray-500">หน้า: <strong className="font-semibold text-gray-700">{stage.page}</strong></p>
              <p className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">{stage.effect}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="manual-loop rounded-xl border-2 border-dashed border-gray-400 px-4 py-2 text-center text-sm text-gray-700">
        <span aria-hidden="true">↺ </span>เมื่อหน้าภาพรวมเตือน “ต่ำกว่าจุดสั่งซื้อ” หรือ “ใกล้หมดอายุ” → กลับไปขั้นที่ 1 สั่งซื้อรอบใหม่
      </p>
      <figcaption className="text-sm text-gray-600">
        วงจรน้ำยาในระบบ — ทุกครั้งที่รับเข้า เบิก หรือปรับยอด ระบบบันทึกไว้ในหน้า <strong>Logs (ประวัติ)</strong>
      </figcaption>
    </figure>
  );
}
