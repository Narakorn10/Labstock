# Lab Smart System (LabReagentControl)

ระบบจัดการคลังน้ำยาห้องปฏิบัติการ พัฒนาด้วย React + Vite และใช้ Google Sheets เป็นฐานข้อมูล

## 🏗️ Architecture (โครงสร้างระบบ)
- **Frontend:** React (Tailwind CSS) โฮสต์บน **Vercel**
- **Backend:** Google Apps Script (GAS) ทำหน้าที่เป็น API Bridge
- **Database:** Google Sheets
- **Source Control:** GitHub ([Narakorn10/Labstock](https://github.com/Narakorn10/Labstock))

## 🚀 Key Features & UX
1.  **Analytics Home:** หน้า "สถิติ" เป็นหน้าแรก แสดงภาพรวมคลังผ่าน Pie Chart และ Bar Chart (เน้นน้ำยาใช้บ่อยที่สต๊อกต่ำ)
2.  **Interactive Filters:** Summary Cards ในหน้า Dashboard สามารถกดเพื่อกรองข้อมูล (ทั้งหมด, ปกติ, ต่ำกว่าเกณฑ์, หมดอายุ) ได้ทันที
3.  **Smart Barcode (GS1):** รองรับการสแกน QR Code มาตรฐาน GS1 ทั้งแบบมีวงเล็บและรหัสยาวต่อเนื่อง (Raw) โดยระบบจะดึงเลข Lot และวันหมดอายุมาให้โดยอัตโนมัติ ช่วยลดความผิดพลาดในการคีย์ข้อมูล
4.  **Sync Count & Dispense:** ระบบนับสต๊อกหน้างานจะคำนวณยอดเบิกให้อัตโนมัติและส่งเข้า "ตะกร้าเบิกส่วนกลาง" พร้อมระบบฉลาดเลือก Lot (FEFO)
4.  **Visual Feedback:** มี Skeleton Loading, Search Highlighting และ Mobile FAB (ปุ่มลอยสแกน) เพื่อการใช้งานที่ลื่นไหล
5.  **Professional Export:** รองรับการออกรายงานเป็น Excel, PDF และข้อความสำหรับแชร์ลงกลุ่ม LINE

## 🛡️ Security & Reliability
- **Secrets Management:** เก็บ LINE Token ใน `Script Properties` ของ GAS (ห้าม Hardcode ในโค้ด)
- **Concurrency Control:** ใช้ `LockService` ใน Backend เพื่อป้องกันข้อมูลทับซ้อนเมื่อมีผู้ใช้งานหลายคนพร้อมกัน
- **Safety Checks:** ระบบตรวจสอบ Item ID และ Lot No. ซ้ำก่อนหักยอดจริงเพื่อป้องกัน Index Shifting

## 🛠️ Developer Notes (Refactored)
- **API Logic:** แยก `api.js` (Production) และ `api.mock.js` (Local Dev) ออกจากกัน ใช้ `import.meta.env.DEV` ควบคุม
- **Component Breakdown:** แยก Dashboard ออกเป็น `DesktopTable`, `MobileCards`, และ `ReportModal` เพื่อการดูแลรักษาง่าย
- **Performance:** ใช้ Batch Processing (setValues ครั้งเดียว) เพื่อลด Latency ระหว่าง Vercel และ GAS

## 🚀 Deployment Workflow
1. **Frontend:** เมื่อ Push โค้ดขึ้น GitHub -> Vercel จะ Auto-build
   - **Environment Variable:** ต้องตั้งค่า `VITE_GAS_URL` ใน Vercel Settings
2. **Backend:** ใช้ `clasp push` เพื่อส่งโค้ด `รหัส.js` ขึ้น Google Script
   - **สำคัญ:** ต้องกด `Deploy > Manage Deployments > Edit > New Version` ทุกครั้งหลัง Push เพื่อให้ API อัปเดต

---
*อัปเดตล่าสุด: 17 พฤษภาคม 2026*