# 🚀 แผนยกระดับฐานข้อมูล Labstock (Integrated Modernization Roadmap)
*ฉบับบูรณาการข้อมูลจาก NotebookLM และ Antigravity Handoff Plan*

แผนงานนี้รวมการปรับปรุงโครงสร้าง (Structural) และการแก้ปัญหาหน้างาน (Functional) เข้าด้วยกันเพื่อความสมบูรณ์แบบของระบบ

---

## 🏗️ ส่วนที่ 1: การปรับโครงสร้างสู่มาตรฐาน PostgreSQL (NotebookLM Grounded)

**เป้าหมาย:** สร้างความแข็งแกร่งให้ข้อมูล (Data Integrity) และประสิทธิภาพ (Performance)

1.  **ยกระดับความสัมพันธ์ (Foreign Keys & Constraints):**
    *   เชื่อม `master_data` (reagent_type, job_type, machine_type) เข้ากับตารางตั้งค่าด้วย `ON UPDATE CASCADE` เพื่อให้ชื่อหมวดหมู่สอดคล้องกันทั้งระบบ
    *   เพิ่ม `CHECK constraint` ในตาราง `inventory` และ `master_data` เพื่อป้องกันยอดคงเหลือติดลบ (`quantity >= 0`)
2.  **มาตรฐานประเภทข้อมูล (Data Types Refactoring):**
    *   แปลง `exp_date` จาก `TEXT` เป็น `DATE` ทั้งในตาราง `inventory` และ `shipments` เพื่อรองรับระบบแจ้งเตือนน้ำยาหมดอายุ
    *   *เทคนิค:* ใช้ Script ตรวจสอบรูปแบบวันที่เดิมและแปลงเป็น ISO (YYYY-MM-DD) ก่อนทำการ `ALTER TABLE`
3.  **การเพิ่มความเร็ว (Indexing Optimization):**
    *   สร้าง Index ที่ `barcode` ในตาราง `master_data` เพื่อให้การสแกน QR Code ค้นหาเจอทันที
    *   สร้าง Index ที่ `timestamp` ในตาราง `logs` (Descending) เพื่อให้หน้าประวัติโหลดข้อมูลล่าสุดได้เร็วที่สุด

---

## 🔍 ส่วนที่ 2: การแก้ไขปัญหาและเพิ่มฟังก์ชันหน้างาน (Antigravity Plan)

**เป้าหมาย:** แก้ปัญหาจุกจิกที่พบใน Phase 4 และเตรียมรับงานวิจัย R2R

1.  **แก้ปัญหา "น้ำยาหายจากเมนู" (Dropdown Automation):**
    *   ปรับปรุง API `/api/master` ให้ทำ **Auto-Upsert** หากผู้ใช้เพิ่มน้ำยาที่มีประเภทใหม่ (เช่น "อื่นๆ") ระบบจะนำชื่อนั้นไปเพิ่มในตารางตั้งค่าโดยอัตโนมัติ ไม่ให้ข้อมูลกำพร้า (Orphaned Data)
2.  **แก้ปัญหา "บันทึก Lot/EXP ไม่ได้" (Logic Hardening):**
    *   ตรวจสอบ Payload จาก Frontend (React State) และปรับ SQL CTE ใน Backend ให้รองรับการ Update กรณีข้อมูลชนกัน (`ON CONFLICT`) อย่างถูกต้อง
3.  **การเตรียม Audit Trail:**
    *   เพิ่มคอลัมน์ `created_at` และ `updated_at` เพื่อให้ทราบว่าใคร แก้ไขข้อมูลอะไร เมื่อไหร่ อย่างละเอียด

---

## 🛠️ ขั้นตอนการลงมือทำ (Execution Steps)

1.  **Phase A (Preparation):** สร้างสคริปต์ `check_data_integrity.mjs` เพื่อสำรวจข้อมูลที่ผิดปกติก่อนอัปเกรด
2.  **Phase B (Migration):** สร้างไฟล์ `upgrade_v2.sql` ที่บรรจุคำสั่ง SQL ทั้งหมดข้างต้น
3.  **Phase C (API Update):** ปรับปรุงโค้ด Next.js API ให้รองรับโครงสร้างฐานข้อมูลใหม่
4.  **Phase D (Verification):** ทดสอบการสแกน, การรับเข้า, และการเบิกจ่าย ว่าบันทึก Lot/EXP ได้ถูกต้อง 100%

---
*จัดทำโดย Gemini CLI - 9 มิถุนายน 2026 - เชื่อมโยงความรู้สู่การลงมือทำจริง*
