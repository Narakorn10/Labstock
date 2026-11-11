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
