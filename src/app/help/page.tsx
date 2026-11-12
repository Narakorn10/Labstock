'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Printer } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { CHAPTERS, type Audience } from './chapters';
import { buildOutline, type OutlineChapter, type OutlineGroup } from './outline';

type Tab = Exclude<Audience, 'all'>;
/** Where a chapter is drawn: on the page or in the print-only copy. Keeps element ids unique. */
type Scope = 'screen' | 'print' | 'measure';
/** เลขหน้าที่แต่ละหัวข้อไปขึ้นในไฟล์ PDF (key = id ของบท หรือ `group-<ส่วน>`) */
type PageMap = Record<string, number>;

/** ความกว้าง/สูงของพื้นที่เนื้อหาในหน้า A4 หลังเว้นขอบ 15 มม. (ใช้จำลองการแบ่งหน้าเพื่อหาเลขหน้าในสารบัญ) */
const PAGE_CONTENT_MM = { width: 180, height: 267 };

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  { id: 'staff', label: 'เจ้าหน้าที่แล็บ', description: 'เบิก รับเข้า ตรวจนับ ยืม/ให้ยืม และงานประจำวัน' },
  { id: 'admin', label: 'ผู้ดูแลห้อง / Admin', description: 'จัดการน้ำยา ผู้ใช้ สิทธิ์ และการตั้งค่า' },
  { id: 'vendor', label: 'บริษัทผู้ขาย (Vendor)', description: 'ดูและตอบใบสั่งซื้อ' },
];

const OUTLINE = buildOutline(CHAPTERS);

function groupOf(audience: Audience): OutlineGroup {
  return OUTLINE.find((group) => group.audience === audience) as OutlineGroup;
}

/** Tab opened first: the one that matches the signed-in role. Anyone can switch to the others. */
function defaultTab(role: string | undefined): Tab {
  if (role === 'Vendor') return 'vendor';
  if (role === 'Admin' || role === 'Manager') return 'admin';
  return 'staff';
}

function ChapterView({ item, scope }: { item: OutlineChapter; scope: Scope }) {
  const { chapter, number } = item;
  return (
    <section id={`${scope}-chapter-${chapter.id}`} data-page-key={chapter.id} aria-labelledby={`${scope}-heading-${chapter.id}`} className="manual-chapter scroll-mt-24 space-y-3 rounded-2xl border border-line bg-white p-5">
      <h3 id={`${scope}-heading-${chapter.id}`} className="text-xl font-medium text-ink">{number} {chapter.title}</h3>
      <div className="text-[15px] leading-7 text-gray-800">{chapter.body}</div>
    </section>
  );
}

function EmptyAudience() {
  return <p className="rounded-2xl border border-line bg-white p-5 text-sm text-gray-600">บทสำหรับกลุ่มนี้กำลังจัดทำ</p>;
}

function Group({ audience, scope }: { audience: Audience; scope: Scope }) {
  const group = groupOf(audience);
  return (
    <div className="manual-group space-y-4">
      <h2 data-page-key={`group-${audience}`} className="text-2xl font-medium text-ink">{group.number}. {group.title}</h2>
      {group.chapters.length === 0
        ? <EmptyAudience />
        : group.chapters.map((item) => <ChapterView key={item.chapter.id} item={item} scope={scope} />)}
    </div>
  );
}

/** สารบัญ: ทุกส่วนและทุกบท. `onPick` (หน้าจอ) เปิดแท็บของบทนั้นก่อนเลื่อนไปหา; ฉบับพิมพ์ใช้ลิงก์ธรรมดา */
function TableOfContents({ scope, onPick, pages }: { scope: Scope; onPick?: (item: OutlineChapter) => void; pages?: PageMap }) {
  const pageOf = (key: string) => (pages ? <span className="manual-toc-page">{pages[key] ?? ''}</span> : null);
  return (
    <nav aria-label="สารบัญ" className="manual-toc rounded-2xl border border-line bg-white p-5">
      <h2 className="text-xl font-medium text-ink">สารบัญ</h2>
      <ol className="mt-3 space-y-3">
        {OUTLINE.map((group) => (
          <li key={group.audience}>
            <p className="manual-toc-row font-medium text-ink"><span className="manual-toc-title">{group.number}. {group.title}</span>{pageOf(`group-${group.audience}`)}</p>
            {group.chapters.length === 0
              ? <p className="manual-toc-empty pl-6 text-sm text-gray-500">(กำลังจัดทำ)</p>
              : (
                <ol className="mt-1 space-y-1 pl-6 text-[15px]">
                  {group.chapters.map((item) => (
                    <li key={item.chapter.id} className="manual-toc-row">
                      <a
                        href={`#${scope}-chapter-${item.chapter.id}`}
                        onClick={onPick ? (event) => { event.preventDefault(); onPick(item); } : undefined}
                        className="text-gray-700 underline-offset-2 hover:underline"
                      >
                        {item.number} {item.chapter.title}
                      </a>
                      {pageOf(item.chapter.id)}
                    </li>
                  ))}
                </ol>
              )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PrintCover() {
  const printedOn = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <section className="manual-cover">
      <p className="manual-cover-kicker">คู่มือการใช้งาน</p>
      <h1 className="manual-cover-title">LabStock</h1>
      <p className="manual-cover-subtitle">ระบบบริหารคลังน้ำยาห้องปฏิบัติการ</p>
      <div className="manual-cover-audience">
        <p>สำหรับ</p>
        <ul>
          <li>เจ้าหน้าที่แล็บ</li>
          <li>ผู้ดูแลห้อง / Admin</li>
          <li>บริษัทผู้ขาย (Vendor)</li>
        </ul>
      </div>
      <p className="manual-cover-date">พิมพ์เมื่อ {printedOn}</p>
    </section>
  );
}

export default function HelpPage() {
  const { user } = useAuth();
  // null = the person has not picked a tab yet, so follow the role once it is known.
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked ?? defaultTab(user?.role);
  // The full manual is portaled to <body> for printing so the print CSS can drop the whole app shell (same as /labels).
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);

  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageMap>({});

  // หาเลขหน้าของแต่ละบทใน PDF: วางเนื้อหาชุดเดียวกันในกล่องที่กว้าง/สูงเท่าพื้นที่เนื้อหา A4
  // โดยให้ CSS columns ทำหน้าที่ "ตัดหน้า" (1 คอลัมน์ = 1 หน้า) แล้วดูว่าหัวข้อไปอยู่คอลัมน์ที่เท่าไร
  useEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const measure = () => {
      const pageWidth = root.clientWidth;
      if (!pageWidth) return;
      const rootLeft = root.getBoundingClientRect().left;
      const next: PageMap = {};
      root.querySelectorAll<HTMLElement>('[data-page-key]').forEach((el) => {
        next[el.dataset.pageKey as string] = Math.floor((el.getBoundingClientRect().left - rootLeft + 1) / pageWidth) + 1;
      });
      setPages((prev) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(prev).length && keys.every((key) => prev[key] === next[key]) ? prev : next;
      });
    };
    measure();
    // ภาพโหลดเสร็จ/ฟอนต์พร้อม/กำลังจะพิมพ์ → ความสูงเปลี่ยน ต้องวัดใหม่
    root.addEventListener('load', measure, true);
    window.addEventListener('beforeprint', measure);
    document.fonts?.ready.then(measure);
    return () => {
      root.removeEventListener('load', measure, true);
      window.removeEventListener('beforeprint', measure);
    };
  }, [isClient]);

  function goToChapter(item: OutlineChapter) {
    const { audience, id } = item.chapter;
    if (audience !== 'all') setPicked(audience);
    // Wait one tick so the newly picked tab has rendered before scrolling to the chapter.
    setTimeout(() => {
      document.getElementById(`screen-chapter-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  return (
    <div className="space-y-6">
      <div className="manual-screen space-y-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-[32px] font-medium leading-tight text-ink">
              <BookOpen size={28} strokeWidth={1.5} aria-hidden="true" />คู่มือการใช้งาน
            </h1>
            <p className="mt-1.5 text-[15px] text-gray-600">LabStock · ระบบบริหารคลังน้ำยา</p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-[10px] bg-ink px-4 py-2 text-sm font-medium text-white"
          >
            <Printer size={16} aria-hidden="true" />ดาวน์โหลด PDF
          </button>
        </div>
        <p className="text-sm text-gray-600">
          กด “ดาวน์โหลด PDF” แล้วเลือกเครื่องพิมพ์เป็น “บันทึกเป็น PDF” (Save as PDF) ไฟล์ที่ได้จะมีหน้าปก สารบัญ และคู่มือครบทุกส่วน
        </p>

        <TableOfContents scope="screen" onPick={goToChapter} />

        <Group audience="all" scope="screen" />

        <div className="space-y-4">
          <div role="tablist" aria-label="เลือกคู่มือตามผู้ใช้งาน" className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`panel-${item.id}`}
                onClick={() => setPicked(item.id)}
                className={`rounded-[10px] border px-4 py-2 text-sm font-medium ${tab === item.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <p className="mb-4 text-sm text-gray-600">{TABS.find((item) => item.id === tab)?.description}</p>
            <Group audience={tab} scope="screen" />
          </div>
        </div>
      </div>

      {isClient && createPortal(
        <>
          <div className="manual-print-area" aria-hidden="true">
            <PrintCover />
            <TableOfContents scope="print" pages={pages} />
            <Group audience="all" scope="print" />
            {TABS.map((item) => <Group key={item.id} audience={item.id} scope="print" />)}
          </div>
          {/* สำเนาที่มองไม่เห็น ใช้วัดเลขหน้า (ไม่ใช้ id ซ้ำกับฉบับพิมพ์) */}
          <div ref={measureRef} className="manual-measure manual-print-area" aria-hidden="true">
            <PrintCover />
            <TableOfContents scope="measure" pages={pages} />
            <Group audience="all" scope="measure" />
            {TABS.map((item) => <Group key={item.id} audience={item.id} scope="measure" />)}
          </div>
        </>,
        document.body
      )}

      <style jsx global>{`
        .manual-print-area { display: none; }

        /* กล่องวัดเลขหน้า: ขนาดเท่าพื้นที่เนื้อหา A4, 1 คอลัมน์ = 1 หน้า, อยู่นอกจอและมองไม่เห็น */
        .manual-print-area.manual-measure {
          display: block; position: absolute; top: 0; left: -10000px; visibility: hidden; pointer-events: none;
          width: ${PAGE_CONTENT_MM.width}mm; height: ${PAGE_CONTENT_MM.height}mm;
          columns: ${PAGE_CONTENT_MM.width}mm; column-gap: 0; column-fill: auto;
          color: #111; font-size: 12pt; line-height: 1.6;
        }
        .manual-measure .manual-cover { min-height: ${PAGE_CONTENT_MM.height - 17}mm; display: flex; flex-direction: column; justify-content: center; break-after: column; padding: 0 10mm; }
        .manual-measure .manual-cover-title { font-size: 44pt; line-height: 1.1; }
        .manual-measure .manual-toc { padding: 0; break-after: column; }
        .manual-measure .manual-group, .manual-measure .manual-chapter { break-before: column; }
        .manual-measure .manual-group > h2 + .manual-chapter { break-before: auto; }

        /* ส่วนที่ใช้ร่วมกันทั้งฉบับพิมพ์และกล่องวัด (ต้องเหมือนกัน ไม่งั้นเลขหน้าเพี้ยน) */
        .manual-print-area .manual-toc h2 { margin: 0 0 10pt; font-size: 20pt; }
        .manual-print-area .manual-toc ol { list-style: none; }
        /* สารบัญกระชับ ให้พอดี 1 หน้า (ระยะห่างของ Tailwind space-y ถูกปิดเฉพาะฉบับพิมพ์) */
        .manual-print-area .manual-toc { font-size: 11pt; line-height: 1.45; }
        .manual-print-area .manual-toc li, .manual-print-area .manual-toc ol > li > p { margin: 0 !important; }
        .manual-print-area .manual-toc ol > li:not(:first-child) { margin-top: 5pt !important; }
        .manual-print-area .manual-toc ol ol { margin-top: 1pt !important; padding-left: 14pt; }
        .manual-print-area .manual-toc-row { display: flex; align-items: baseline; gap: 6pt; }
        .manual-print-area .manual-toc-title, .manual-print-area .manual-toc-row > a { flex: 0 1 auto; }
        .manual-print-area .manual-toc-page { flex: 1 1 auto; display: flex; align-items: baseline; justify-content: flex-end; gap: 4pt; font-variant-numeric: tabular-nums; }
        .manual-print-area .manual-toc-page::before { content: ''; flex: 1 1 auto; border-bottom: 1.5pt dotted #888; transform: translateY(-3pt); }
        .manual-print-area .manual-group > h2 { margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 3pt solid #1d1f20; font-size: 22pt; break-after: avoid; }
        .manual-print-area .manual-chapter { border: 0; padding: 0; margin-bottom: 14pt; }
        .manual-print-area .manual-chapter h3 { margin: 0 0 10pt; padding-bottom: 4pt; border-bottom: 1pt solid #999; font-size: 18pt; break-after: avoid; }
        .manual-print-area .manual-figure, .manual-print-area .manual-note, .manual-print-area .manual-steps li { break-inside: avoid; }
        /* หัวตารางไม่พิมพ์ซ้ำทุกหน้า และแถวไม่ถูกตัดกลาง — ให้การแบ่งหน้าตรงกับกล่องวัดเลขหน้า */
        /* กล่องเลื่อนแนวนอนของตารางต้องตัดข้ามหน้าได้เหมือนกันทั้งสองแบบ (กล่อง overflow เป็นก้อนเดียวในกล่องวัด) */
        .manual-print-area div { overflow: visible !important; }
        .manual-print-area thead { display: table-row-group; }
        .manual-print-area tr { break-inside: avoid; }
        .manual-print-area .manual-figure img { max-width: 100%; max-height: 110mm; width: auto; margin: 0 auto; display: block; }

        @media print {
          /* เลขหน้าที่ท้ายกระดาษทุกหน้า (หน้าปกไม่แสดง) — Chrome 131 ขึ้นไป */
          @page { size: A4; margin: 15mm; @bottom-center { content: "หน้า " counter(page); font-size: 10pt; color: #555; } }
          @page :first { @bottom-center { content: none; } }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(.manual-print-area) { display: none !important; }
          .manual-print-area { display: block; color: #111; font-size: 12pt; line-height: 1.6; }
          .manual-print-area.manual-measure { display: none !important; }
          .manual-print-area a { color: inherit; text-decoration: none; }

          /* หน้าปก: เต็มหน้าแรก แล้วขึ้นหน้าใหม่ */
          .manual-cover { min-height: 250mm; display: flex; flex-direction: column; justify-content: center; break-after: page; padding: 0 10mm; border-left: 6pt solid #1d1f20; }
          .manual-cover-kicker { margin: 0; font-size: 16pt; color: #555; }
          .manual-cover-title { margin: 0; font-size: 44pt; font-weight: 700; line-height: 1.1; }
          .manual-cover-subtitle { margin: 6pt 0 36pt; font-size: 16pt; }
          .manual-cover-audience p { margin: 0 0 4pt; font-weight: 600; }
          .manual-cover-audience ul { margin: 0; padding-left: 16pt; list-style: disc; }
          .manual-cover-date { margin-top: 48pt; color: #555; }

          /* สารบัญ: หน้าเดียวของตัวเอง แล้วขึ้นหน้าใหม่ */
          .manual-toc { border: 0 !important; padding: 0 !important; }

          /* ทุกส่วนและ "ทุกบท" เริ่มหน้าใหม่ (บทแรกของส่วนอยู่หน้าเดียวกับหัวข้อส่วน) */
          .manual-print-area:not(.manual-measure) .manual-group,
          .manual-print-area:not(.manual-measure) .manual-chapter { break-before: page; }
          .manual-print-area:not(.manual-measure) .manual-group > h2 + .manual-chapter { break-before: auto; }
        }
      `}</style>
    </div>
  );
}
