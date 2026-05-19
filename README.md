# 🔬 Lab Smart System (LabReagentControl)

ระบบจัดการคลังน้ำยาอัจฉริยะสำหรับห้องปฏิบัติการทางการแพทย์ พัฒนาด้วย **React 19** และ **Google Apps Script**

## 🌟 ฟีเจอร์เด่น
*   **📊 Real-time Dashboard:** ดูยอดคงเหลือน้ำยาทั้งหมด พร้อมระบบเตือนสีแดงเมื่อสต๊อกต่ำกว่าเกณฑ์ (Min Alert)
*   **🤖 Smart QR/Barcode:** รองรับมาตรฐาน GS1 ดึงเลข Lot และวันหมดอายุอัตโนมัติจากการสแกนครั้งเดียว
*   **🔄 Integrated Workflow:** เชื่อมโยงระบบ "นับสต๊อกหน้างาน" เข้ากับ "การเบิกจ่าย" ช่วยคำนวณยอดที่ต้องเบิกเติมให้อัตโนมัติ
*   **🛡️ FEFO logic:** ระบบแนะนำการเบิกน้ำยาตามวันหมดอายุ (First Expired, First Out) เพื่อลดการสูญเสีย
*   **📑 Professional Reports:** ออกรายงานยอดคงเหลือและสรุปการใช้ในรูปแบบ Excel, PDF และข้อความสำหรับส่งใน LINE

## 🏗️ โครงสร้างเทคโนโลยี
*   **Frontend:** React 19 + Vite + Tailwind CSS 4 (Hosted on Vercel)
*   **Backend:** Google Apps Script (GAS)
*   **Database:** Google Sheets
*   **Deployment:** CI/CD via GitHub + Vercel + clasp

## 🚀 การติดตั้งและพัฒนา
1.  **Backend:** ใช้ `clasp push` เพื่อส่งโค้ด `รหัส.js` ขึ้น Google Script
2.  **Frontend:** ตั้งค่า Environment Variable `VITE_GAS_URL` ใน Vercel
3.  **Database:** กดปุ่ม "Setup DB" ในหน้า Master เพื่อสร้างแผ่นงานเริ่มต้น

---
*โปรเจคนี้พัฒนาขึ้นเพื่อเพิ่มประสิทธิภาพในการบริหารจัดการทรัพยากรในห้องปฏิบัติการ*
