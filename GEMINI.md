# 🔬 Lab Smart System (LabReagentControl) - Project Memory

เอกสารนี้รวบรวมโครงสร้างและรายละเอียดทั้งหมดของโปรเจค เพื่อใช้เป็น Context ให้ AI ทำงานต่อได้ทันทีโดยไม่ต้องอ่านโค้ดใหม่ทั้งหมด ช่วยประหยัดเวลาและ Token ในการเริ่ม Session ใหม่

## 🏗️ Tech Stack & Architecture
- **Frontend:** React 19 + Vite + Tailwind CSS 4 (Hosted on **Vercel**)
- **Backend/API:** Google Apps Script (GAS) ทำหน้าที่เป็น Bridge รับ-ส่งข้อมูล
- **Database:** Google Sheets (ประกอบด้วยแผ่นงาน: `MasterData`, `Inventory`, `Logs`, `Settings`)
- **Source Control:** GitHub ([Narakorn10/Labstock](https://github.com/Narakorn10/Labstock))

## 📁 Project Structure (ไฟล์และโมดูลสำคัญ)
### Backend (GAS)
- `รหัส.js`: โค้ด Backend หลัก ทำหน้าที่รับ POST request จาก Frontend (`doPost`), มีระบบจัดการ Concurrency (`LockService`), จัดการการรับเข้า/เบิกจ่าย, บันทึก Logs, และดึง Token สำหรับส่งแจ้งเตือน LINE Notify

### Frontend (`frontend/src/`)
- `App.jsx`: จุดศูนย์กลางจัดการ Routing (ผ่าน State `activeTab`) และจัดการ State ของ "ตะกร้าเบิกจ่าย" (Dispense Cart), ตะกร้ารับเข้า (Receive Cart) และระบบแจ้งเตือน (Toast)
- `api.js` / `api.mock.js`: ไฟล์เชื่อมต่อ API หากอยู่บน Production จะเรียกไปที่ `VITE_GAS_URL` หากรัน Local/Dev จะเรียกใช้ Mock Data แบบจำลอง delay เพื่อความรวดเร็วในการพัฒนา UI
- `utils/barcodeParser.js`: **[สำคัญ]** Core logic สำหรับการแปลงบาร์โค้ด รองรับ GS1-128 (Application Identifiers เช่น (01)GTIN, (10)Lot, (17)EXP, (11)MFG, (240)REF) แบบแปรผันความยาว (ดักจับ `<GS>` ASCII 29 delimiter) และ 1D Barcode ทั่วไป
- `hooks/`: 
  - `useGlobalData.js`: ดึง Master Data และ Settings จาก Backend มาเก็บไว้ใช้งานแบบ Global
  - `useExport.js`: จัดการการออกรายงาน Excel (CSV), สร้าง HTML สำหรับ Print/PDF, และคัดลอกสรุปสต๊อกเพื่อส่งลง LINE
- `tabs/`: Component หน้าจอแต่ละหน้า 
  - `DashboardTab`: ดูสต๊อกคงเหลือราย Item และเจาะดูราย Lot
  - `AnalyticsTab`: ดูกราฟสรุป และน้ำยาตัวหลัก (Core Reagent) ที่ยอดสต๊อกต่ำ
  - `TransactionTab`: ใช้ทั้งฝั่ง "รับเข้า" และ "เบิกจ่าย" จัดการเรื่องสแกนบาร์โค้ด
  - `CountTab`: หน้าสำหรับเดินนับสต๊อกหน้างาน
  - `MasterTab`: จัดการฐานข้อมูลน้ำยาตั้งต้น
  - `LogsTab`: ดูประวัติการใช้งานย้อนหลัง

## 🚀 Key Business Logic (ระบบที่ซับซ้อน)
1.  **Smart Barcode (GS1 Parser):** ในตอนสแกนรับเข้าหรือเบิกจ่าย ระบบจะถอดรหัส GTIN, Lot No., วันหมดอายุ ออกจากบาร์โค้ดเดียวโดยอัตโนมัติ (แปลงรูปแบบ `YYMMDD` เป็น `YYYY-MM-DD` ให้เลย) หากเป็นบาร์โค้ดทั่วไป (Standard 1D) จะบังคับให้ผู้ใช้กรอก Lot/EXP เอง
2.  **FEFO (First Expired, First Out):** ในหน้าเบิกจ่าย (Dispense) หากสแกน GTIN ทั่วไป ระบบจะดึงและแนะนำ Lot ที่จะหมดอายุก่อนมาให้ตัดสต๊อกโดยอัตโนมัติ
3.  **Sync Count & Auto-Dispense:** หน้า "นับหน้างาน" จะเปรียบเทียบยอดที่นับได้จริงกับเป้าหมายที่ตั้งไว้ (Weekly Target) หากยอดขาด จะแสดงปุ่มให้กดเพิ่มส่วนต่างลงใน "ตะกร้าเบิกส่วนกลาง" ทันที ไม่ต้องไปคีย์ตัวเลขเบิกเองทีละตัว
4.  **Low Stock Alert:** เมื่อมีการตัดสต๊อก ระบบหลังบ้าน (GAS) จะเช็คยอดคงเหลือรวม หากน้อยกว่าจุดเตือน (`minThreshold`) จะส่ง LINE Notify แจ้งเตือนผู้ดูแลทันที

## 🛡️ Security & Reliability
- **Secrets:** LINE Token ห้าม Hardcode เด็ดขาด ดึงผ่าน `PropertiesService.getScriptProperties().getProperty('LINE_TOKEN')` ของ Google Apps Script
- **Data Integrity:** ทุกฟังก์ชันที่มีการแก้ไขข้อมูลใน Sheet (`addMasterItem`, `updateMasterItem`, `receiveBatch`, `dispenseBatch`, `adjustLotQuantity`) จะถูกครอบด้วย `LockService.getScriptLock().waitLock(30000)` เสมอเพื่อป้องกัน Race Condition
- **Error Boundaries:** การสแกนบาร์โค้ดมีการจำกัด Loop (Max AIs) ป้องกัน Infinite Loop ในหน้า UI กรณีที่บาร์โค้ดผิดรูป

## 🚀 Deployment Workflow
1. **Frontend:** เมื่อพุชโค้ดขึ้น GitHub -> Vercel จะทำการ Auto-build 
   - *ข้อควรระวัง:* ต้องตรวจสอบว่าตั้งค่า `VITE_GAS_URL` ใน Environment Variables ของ Vercel ตรงกับ API ของ GAS แล้ว
2. **Backend:** ใช้คำสั่ง `clasp push` เพื่อส่งไฟล์ `รหัส.js` ขึ้น Google Apps Script
   - **สำคัญมาก:** หลังจากแก้ไข `รหัส.js` หรืออัปเดตโค้ดฝั่ง Backend ต้องเข้าเว็บ Apps Script เพื่อกด `Deploy > Manage Deployments > Edit > New Version` แล้วกด Deploy ทุกครั้ง ไม่เช่นนั้น URL เดิมจะไม่ดึงโค้ดล่าสุดมาใช้

---
*อัปเดตล่าสุด: พฤษภาคม 2026 (อัปเดตข้อมูลระบบ GS1 Barcode Parser ให้รองรับ Variable Length AI อย่างสมบูรณ์)*