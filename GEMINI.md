# 🧪 LabStock Next.js - Project Updates & Architecture

เอกสารนี้รวบรวมฟีเจอร์และโครงสร้างที่อัปเดตล่าสุด (พฤษภาคม 2026) เพื่อใช้เป็นแนวทางในการพัฒนาต่อ

## 🚀 ฟีเจอร์ที่พอร์ตและพัฒนาเพิ่ม (Phase 2 & 3)

### 1. ระบบจัดการผู้ใช้และสิทธิ์ (Auth & Access Control)
- **Login System:** รองรับการเข้าสู่ระบบผ่าน Username/Password โดยใช้ SHA-256 Hashing (ตรงกับระบบเดิม)
- **Role-based Navigation:** 
  - `Admin`: เข้าถึงได้ทุกเมนู รวมถึงจัดการผู้ใช้
  - `Manager`: จัดการน้ำยา (Master Data) และดูสถิติได้
  - `Operator`: เน้นการเบิกจ่ายและดู Dashboard
  - `User`: ใช้งานทั่วไป (เบิก/รับ/นับ/ประวัติ)
- **Session Management:** ใช้ `AuthProvider` (Context) และ `LocalStorage` ในการจำลอง Session ตรวจสอบสถานะการ Login ทุกครั้งที่เปลี่ยนหน้า

### 2. ระบบวิเคราะห์การใช้ (Usage Analysis)
- **Dashboard สถิติ:** ใช้ `Recharts` แสดงผลกราฟวงกลม (Stock Health) และกราฟแท่ง (Usage Trends)
- **Date Filtering:** เลือกช่วงเวลาในการวิเคราะห์ข้อมูลการเบิกจ่ายได้ยืดหยุ่น
- **Aggregation Logic:** API `/api/usage` ทำหน้าที่ดึง Log ดิบจาก Sheet มาประมวลผลเป็นยอดรวมรายรายการ

### 3. ระบบนับสต๊อก (React-style Stock Count)
- **UI Migration:** พอร์ตหน้าจอ "นับสต๊อกหน้างาน" จากโปรเจกต์ React เดิมมาทั้งหมด
- **Auto-Dispense (Sync Now):** ระบบเปรียบเทียบยอดนับกับเป้าหมาย (Weekly Target) และทำการเบิกจ่ายส่วนต่างออกจากสต๊อกหลักให้โดยอัตโนมัติด้วยระบบ FEFO

### 4. UI/UX และความเป็นระเบียบ
- **Light Mode Only:** ยกเลิกการใช้งาน Dark Mode และพื้นหลังสีดำ เพื่อความสะอาดตาและเป็นระเบียบตามความต้องการของผู้ใช้
- **Modern Layout:** ใช้ระบบ Sidebar แบบพับได้บนมือถือ และตารางข้อมูลที่รองรับการเลื่อน (Scroll) ได้ดี

## 🏗️ Technical Architecture
- **Framework:** Next.js 16 (App Router) + Tailwind CSS 4
- **Database:** Google Sheets ผ่าน `google-spreadsheet` library
- **Icons:** Lucide React
- **Charts:** Recharts

## 📁 ไฟล์สำคัญที่สร้างใหม่
- `src/components/auth-provider.tsx`: จัดการสถานะผู้ใช้และสิทธิ์
- `src/components/modal.tsx`: Component หน้าต่าง Pop-up เอนกประสงค์
- `src/app/api/auth/login/route.ts`: API สำหรับพิสูจน์ตัวตน
- `src/app/api/users/`: API สำหรับ CRUD ข้อมูลผู้ใช้งาน
- `src/app/master/users/page.tsx`: หน้าจอจัดการผู้ใช้งาน
- `src/app/analysis/page.tsx`: หน้าจอวิเคราะห์ข้อมูล

---
*บันทึกโดย Gemini CLI - 30 พฤษภาคม 2026*
