import type { Audience, Chapter } from './chapters';

/** ลำดับส่วนในคู่มือ (ใช้ทั้งสารบัญ หน้าจอ และ PDF) */
export const AUDIENCE_ORDER: Audience[] = ['all', 'staff', 'admin', 'vendor'];

export const AUDIENCE_TITLE: Record<Audience, string> = {
  all: 'เริ่มต้นใช้งาน (ทุกคน)',
  staff: 'สำหรับเจ้าหน้าที่แล็บ',
  admin: 'สำหรับผู้ดูแลห้อง / Admin',
  vendor: 'สำหรับบริษัทผู้ขาย (Vendor)',
};

export type OutlineChapter = { chapter: Chapter; number: string };
export type OutlineGroup = { audience: Audience; number: string; title: string; chapters: OutlineChapter[] };

/**
 * จัดบททั้งหมดเป็นส่วน ๆ พร้อมเลขหัวข้อแบบ "ส่วน.บท" (เช่น 2.3)
 * เลขเดียวกันใช้ทั้งในสารบัญและหัวข้อบท ผู้อ่านจึงอ้างถึงกันได้
 */
export function buildOutline(chapters: Chapter[]): OutlineGroup[] {
  return AUDIENCE_ORDER.map((audience, groupIndex) => {
    const number = `${groupIndex + 1}`;
    return {
      audience,
      number,
      title: AUDIENCE_TITLE[audience],
      chapters: chapters
        .filter((chapter) => chapter.audience === audience)
        .map((chapter, index) => ({ chapter, number: `${number}.${index + 1}` })),
    };
  });
}
