# Lab Smart System Architecture

เอกสารแสดงผังโครงสร้างและระบบการทำงานของ Lab Smart System (Labstock)

## 📁 โครงสร้างโฟลเดอร์ (File Structure)

```text
Labstock (Root)
├── 📄 รหัส.js                # Backend: API และตัวจัดการ Google Sheets (GAS)
├── 📄 index.html             # ผลลัพธ์จากการ Build Frontend (Single File)
├── 📄 GEMINI.md              # หน่วยความจำโครงการ (Instructions & Features)
├── 📄 ARCHITECTURE.md        # เอกสารฉบับนี้ (Project Structure & Flow)
├── 📄 appsscript.json        # การตั้งค่าพื้นฐานของ Google Apps Script
└── 📁 frontend               # โฟลเดอร์หลักของหน้าเว็บ (React + Vite)
    ├── 📁 src
    │   ├── 📁 components     # ส่วนประกอบ UI ที่ใช้ซ้ำได้
    │   │   ├── 📁 dashboard  # ส่วนประกอบเฉพาะของหน้าแดชบอร์ด
    │   │   │   ├── 📄 DesktopTable.jsx
    │   │   │   ├── 📄 MobileCards.jsx
    │   │   │   ├── 📄 ReportModal.jsx
    │   │   │   └── 📄 SummaryCards.jsx
    │   │   ├── 📄 Badge.jsx
    │   │   ├── 📄 Modal.jsx
    │   │   ├── 📄 QRScanner.jsx
    │   │   ├── 📄 Select2.jsx
    │   │   └── 📄 Skeleton.jsx
    │   ├── 📁 hooks          # Logic การทำงาน (Custom Hooks)
    │   │   ├── 📄 useExport.js      # จัดการการส่งออกไฟล์/รูป/LINE
    │   │   ├── 📄 useGlobalData.js  # ดึงข้อมูลจาก Google Sheets
    │   │   └── 📄 useAppToast.js    # จัดการการแจ้งเตือนบนหน้าจอ
    │   ├── 📁 tabs           # หน้าหลักแต่ละแท็บ
    │   │   ├── 📄 AnalyticsTab.jsx   # หน้าสถิติ (Home)
    │   │   ├── 📄 DashboardTab.jsx   # หน้าคลังสินค้า
    │   │   ├── 📄 CountTab.jsx       # หน้านับสต๊อกหน้างาน
    │   │   ├── 📄 TransactionTab.jsx # หน้าเบิกจ่าย/รับเข้า
    │   │   ├── 📄 MasterTab.jsx      # หน้าจัดการข้อมูลหลัก
    │   │   └── 📄 LogsTab.jsx        # หน้าประวัติ
    │   ├── 📁 utils
    │   │   └── 📄 text.jsx           # ฟังก์ชันช่วย (เช่น ไฮไลต์คำค้นหา)
    │   ├── 📄 api.js         # ตัวเชื่อมต่อ API หลัก (Production)
    │   ├── 📄 api.mock.js    # ข้อมูลสมมติสำหรับทดสอบ (Local Dev)
    │   └── 📄 App.jsx        # จุดศูนย์กลางคุม Navigation และ State
    └── 📄 vite.config.js     # การตั้งค่าการ Build (รวมถึง Single File)
```

---

## 🔄 แผนผังการทำงาน (Data Flow)

1.  **Database Layer (Google Sheets):** 
    - เก็บข้อมูลใน 4 แผ่นงานหลัก: `MasterData`, `Inventory`, `Logs`, `Settings`
2.  **API Layer (Google Apps Script - `รหัส.js`):** 
    - ทำหน้าที่เป็น Bridge รับคำสั่ง `POST` จาก Frontend
    - ใช้ `LockService` เพื่อป้องกันปัญหา Race Condition (คนบันทึกพร้อมกัน)
    - ส่ง `LINE Notify` เมื่อยอดสต๊อกรวมต่ำกว่าเกณฑ์
3.  **State Management (Frontend - `App.jsx`):** 
    - ใช้ **Centralized State** ใน `App.jsx` เพื่อจัดการ "ตะกร้าเบิก" (Dispense Cart) ส่วนกลาง
    - เชื่อมโยงข้อมูลระหว่างแท็บ (เช่น จากแท็บ "นับหน้างาน" ส่งยอดเข้า "ตะกร้าเบิก")
4.  **UI & Interaction Layer:**
    - **Analytics:** สรุปข้อมูลเป็นกราฟวงกลมและแท่ง (Recharts)
    - **Filtering:** ใช้ระบบ Quick Filter ผ่าน Summary Cards
    - **Workflow:** ยึดหลัก FEFO (First Expired First Out) ในการเบิกจ่ายอัตโนมัติ

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)
- **Frontend:** React 19, Vite, Tailwind CSS 4
- **Charts:** Recharts
- **Icons:** FontAwesome 6
- **Backend:** Google Apps Script (GAS)
- **Deployment:** Vercel (Frontend), clasp (Backend)

---
*จัดทำเอกสารเมื่อ: 17 พฤษภาคม 2026*