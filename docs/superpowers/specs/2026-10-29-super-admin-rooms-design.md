# Super admin + หน้าจัดการห้อง (design)

สถานะ: **ร่าง รอผู้ใช้อนุมัติ** (ยังไม่เขียนโค้ด) · วันที่ 2026-10-29 · ยังไม่ commit (checkout นี้อยู่บน branch เก่า `fix/reagent-loan-return`; งานจริงต้องทำบน worktree จาก `origin/main`)

## เจตนาและเหตุผล
ตอนนี้การตั้งรหัสห้อง (`departments.code`) ต้องรัน SQL บน production เอง หน้า Settings เพิ่มห้องได้แค่ชื่อ (`src/app/api/settings/route.ts:133`) ห้องที่ไม่มีรหัสจะไม่ขึ้นในหน้าสมัคร (`src/lib/user-rooms.ts:13`)
ผู้ใช้ต้องการ **Super admin** (บทบาทสูงกว่า Admin) ที่จัดการห้องทั้งหมดผ่านหน้าจอได้ ไม่ต้องรัน SQL

## เป้าหมาย
- Super admin = `5783` คนเดียว (ผู้ใช้ระบุ; ปัจจุบัน role `Admin`, active)
- หน้าจอเดียวจัดการ: สร้างห้อง, ตั้ง/แก้รหัส, เปิด/ปิด, เปลี่ยนชื่อ, ตั้ง/ถอด Admin, ดูแลสมาชิกข้ามห้อง
- สิทธิ์เดิมของ Admin ทุกจุดทำงานเหมือนเดิม

## ไม่ใช่เป้าหมาย / สิ่งที่ห้ามเกิด
- ไม่เพิ่มหน้าจอตั้ง Super admin (กำหนดในฐานข้อมูลเท่านั้น)
- ห้ามทำให้ Admin ปัจจุบันหรือ `5783` เข้าห้องไม่ได้ หรือสิทธิ์เดิมพัง
- ห้าม Admin ธรรมดา/ผู้ดูแลห้อง/Vendor เข้าหน้านี้หรือเรียก API นี้ได้
- ห้ามลบห้องถาวร (ปิดใช้งานเท่านั้น)

## ข้อจำกัด (จากหลักฐาน)
- Schema production (Neon, อ่านอย่างเดียว 2026-10-29): `users.role` เป็น text ไม่มี CHECK; `departments(id, name UNIQUE, code NULL, is_active)`; `user_departments(username, department_id, role, is_default, admin_slot 1|2)`; `lab_profile.department_id NOT NULL`
- Role ที่มี: Admin/Manager/Operator/User/Vendor (`src/lib/menu-config.ts:103`)
- ไฟล์ SQL ใน repo ไม่ตรงฐานจริงบางส่วน → ต้องดู schema จริงก่อนเขียน migration
- migration ใหม่ใช้ `scripts/apply-migration.mjs --confirm-host` ผู้ใช้รันเอง; เขียน production ต้องขออนุมัติทุกขั้น

## วิธีที่พิจารณา
- A: role ใหม่ `SuperAdmin` ใน `users.role` — ตรงชื่อ แต่ต้องแก้ทุกจุดที่เช็ก `role === "Admin"` และรายการ role ซ้ำ 4 แห่ง เสี่ยงสิทธิ์เดิมพัง
- **B (ผู้ใช้เลือก):** คง `5783` เป็น `Admin` + เพิ่มคอลัมน์ `users.is_super_admin boolean NOT NULL DEFAULT false` — สิทธิ์เดิมไม่ถูกแตะ; เสี่ยงน้อยกว่า

## การออกแบบ (ตามที่ตกลง)
- Flag อ่านจากฐานข้อมูลทุกครั้งที่เรียก API/หน้า (ไม่เชื่อค่าใน session/token ที่ client ส่งมา); ต้องเป็น `role = 'Admin'` **และ** `is_super_admin = true` **และ** `account_status = 'active'`
- ตั้งค่า flag ให้ `5783` ด้วย SQL migration ที่ผู้ใช้รันเอง
- แบ่ง 3 PR ตามลำดับ (แยกบั๊ก/ฟีเจอร์, ทีละน้อย):
  1. ฐานสิทธิ์: migration + helper `requireSuperAdmin` + เทสต์ (Admin ธรรมดาถูกปฏิเสธ 403)
  2. หน้าจัดการห้อง: สร้าง/ตั้งรหัส/เปิด-ปิด/เปลี่ยนชื่อ
  3. ตั้ง-ถอด Admin และดูแลสมาชิกข้ามห้อง
- ทุก action เขียน `app_events` (ใคร ทำอะไร กับห้องไหน)

## ปล่อยให้ผู้สร้างตัดสิน (ผมเสนอเป็นค่าเริ่มต้น)
- กติการหัสห้อง: ตัวพิมพ์ใหญ่/ตัวเลข ยาว 2–10, ห้ามซ้ำ, ห้ามใช้ `LAB` (item_id เดิมขึ้นต้น `LAB-`), ห้ามแก้รหัส `CC`; รหัสที่ตั้งแล้วห้ามเปลี่ยน (ผูกกับข้อมูล) — **ข้อเสนอของผม ผู้ใช้ยังไม่ได้ยืนยัน**
- ปิดห้องที่มีสมาชิก/ข้อมูล: อนุญาตแต่ต้องมีข้อความยืนยัน; ห้ามปิด `CC`
- ห้องใหม่ต้องมี `lab_profile` (ชื่อองค์กร/ที่อยู่/โลโก้) ก่อนเปิดใช้ — PR 2 ต้องตัดสินว่าหน้าจอกรอกให้เลยหรือไม่
- เมนู: เห็นเฉพาะ Super admin

## ความเสี่ยง
เป็นงานแตะ RBAC และ production ตามกฎ `05-lab-stock-nextjs.md` → ต้องซ้อม migration บน Neon branch แยก, ขออนุมัติก่อนรันบน production, มีเทสต์ vitest+PGlite ครอบสิทธิ์ทุกทาง
