# Lab Smart System (LabReagentControl)

ระบบจัดการคลังน้ำยาห้องปฏิบัติการ พัฒนาด้วย React + Vite และใช้ Google Sheets เป็นฐานข้อมูล

## 🏗️ Architecture (โครงสร้างระบบ)
- **Frontend:** React (Tailwind CSS) โฮสต์บน **Vercel**
- **Backend:** Google Apps Script (GAS) ทำหน้าที่เป็น API Bridge
- **Database:** Google Sheets
- **Source Control:** GitHub ([Narakorn10/Labstock](https://github.com/Narakorn10/Labstock))

## 🚀 Deployment Workflow
1. **Frontend:** เมื่อ Push โค้ดขึ้น GitHub -> Vercel จะ Auto-build
   - **Environment Variable:** ต้องตั้งค่า `VITE_GAS_URL` ใน Vercel Settings
2. **Backend:** ใช้ `clasp push` เพื่อส่งโค้ด `รหัส.js` ขึ้น Google Script
   - **สำคัญ:** ต้องกด `Deploy > Manage Deployments > Edit > New Version` ทุกครั้งหลัง Push เพื่อให้ API อัปเดต

## 🔍 Search & Scan Logic
- **Search:** การพิมพ์ค้นหาจะเช็คเฉพาะคอลัมน์ **"ชื่อน้ำยา"** เท่านั้น
- **Scan:** การแสกน QR/Barcode หรือพิมพ์รหัสจนครบ จะแสดงรายการเมื่อตรงกับ **Item ID** หรือ **Barcode** แบบ 100%
- **Scanner:** ปรับจูนความเร็วที่ 20 FPS และมีเสียง Beep เมื่อแสกนติด

## 🛠️ Data Robustness
- ระบบใช้การค้นหาหัวข้อ (Header-aware) เพื่อป้องกันปัญหาคอลัมน์สลับกัน
- มีฟังก์ชัน `migrateOldInventoryToNew` สำหรับย้ายสต๊อกเมื่อมีการเปลี่ยนรหัส Item ID
