'use client';

import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Printer } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { CHAPTERS, type Audience } from './chapters';
import { buildOutline, type OutlineChapter, type OutlineGroup } from './outline';

type Tab = Exclude<Audience, 'all'>;
/** Where a chapter is drawn: on the page or in the print-only copy. Keeps element ids unique. */
type Scope = 'screen' | 'print';

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
    <section id={`${scope}-chapter-${chapter.id}`} aria-labelledby={`${scope}-heading-${chapter.id}`} className="manual-chapter scroll-mt-24 space-y-3 rounded-2xl border border-line bg-white p-5">
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
      <h2 className="text-2xl font-medium text-ink">{group.number}. {group.title}</h2>
      {group.chapters.length === 0
        ? <EmptyAudience />
        : group.chapters.map((item) => <ChapterView key={item.chapter.id} item={item} scope={scope} />)}
    </div>
  );
}

/** สารบัญ: ทุกส่วนและทุกบท. `onPick` (หน้าจอ) เปิดแท็บของบทนั้นก่อนเลื่อนไปหา; ฉบับพิมพ์ใช้ลิงก์ธรรมดา */
function TableOfContents({ scope, onPick }: { scope: Scope; onPick?: (item: OutlineChapter) => void }) {
  return (
    <nav aria-label="สารบัญ" className="manual-toc rounded-2xl border border-line bg-white p-5">
      <h2 className="text-xl font-medium text-ink">สารบัญ</h2>
      <ol className="mt-3 space-y-3">
        {OUTLINE.map((group) => (
          <li key={group.audience}>
            <p className="font-medium text-ink">{group.number}. {group.title}</p>
            {group.chapters.length === 0
              ? <p className="manual-toc-empty pl-6 text-sm text-gray-500">(กำลังจัดทำ)</p>
              : (
                <ol className="mt-1 space-y-1 pl-6 text-[15px]">
                  {group.chapters.map((item) => (
                    <li key={item.chapter.id}>
                      <a
                        href={`#${scope}-chapter-${item.chapter.id}`}
                        onClick={onPick ? (event) => { event.preventDefault(); onPick(item); } : undefined}
                        className="text-gray-700 underline-offset-2 hover:underline"
                      >
                        {item.number} {item.chapter.title}
                      </a>
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
        <div className="manual-print-area" aria-hidden="true">
          <PrintCover />
          <TableOfContents scope="print" />
          <Group audience="all" scope="print" />
          {TABS.map((item) => <Group key={item.id} audience={item.id} scope="print" />)}
        </div>,
        document.body
      )}

      <style jsx global>{`
        .manual-print-area { display: none; }
        @media print {
          @page { size: A4; margin: 15mm; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(.manual-print-area) { display: none !important; }
          .manual-print-area { display: block; color: #111; font-size: 12pt; line-height: 1.6; }
          .manual-print-area a { color: inherit; text-decoration: none; }

          /* หน้าปก: เต็มหน้าแรก แล้วขึ้นหน้าใหม่ */
          .manual-cover { min-height: 250mm; display: flex; flex-direction: column; justify-content: center; break-after: page; padding: 0 10mm; border-left: 6pt solid #1d1f20; }
          .manual-cover-kicker { margin: 0; font-size: 16pt; color: #555; }
          .manual-cover-title { margin: 0; font-size: 44pt; font-weight: 700; line-height: 1.1; }
          .manual-cover-subtitle { margin: 6pt 0 36pt; font-size: 16pt; }
          .manual-cover-audience p { margin: 0 0 4pt; font-weight: 600; }
          .manual-cover-audience ul { margin: 0; padding-left: 16pt; list-style: disc; }
          .manual-cover-date { margin-top: 48pt; color: #555; }

          /* สารบัญ: หน้าเดียวของตัวเอง */
          .manual-toc { border: 0 !important; padding: 0 !important; }
          .manual-toc h2 { margin: 0 0 10pt; font-size: 20pt; }
          .manual-toc ol { list-style: none; }

          /* แต่ละส่วนเริ่มหน้าใหม่ */
          .manual-group { break-before: page; }
          .manual-print-area h2 { margin: 0 0 8pt; font-size: 17pt; break-after: avoid; }
          .manual-chapter { border: 0 !important; padding: 0 !important; margin-bottom: 14pt; }
          .manual-chapter h3 { break-after: avoid; }
          .manual-figure, .manual-note, .manual-steps li { break-inside: avoid; }
          .manual-figure img { max-width: 100%; max-height: 110mm; width: auto; margin: 0 auto; display: block; }
        }
      `}</style>
    </div>
  );
}
