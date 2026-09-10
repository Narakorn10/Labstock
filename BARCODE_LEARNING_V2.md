# QR/Barcode Learning V2

V2 เป็นระบบเสริมที่แยกจาก `barcode_patterns` เดิมทางกายภาพ และปิด runtime โดยค่าเริ่มต้น

## เปิดใช้งานเป็นขั้น

1. ตรวจสอบ SQL `upgrade_v19_barcode_learning_v2.sql` กับฐานข้อมูลจริงและรันโดยผู้มีสิทธิ์ดูแลฐานข้อมูล
2. ตั้ง `BARCODE_LEARNING_V2_MANAGEMENT_ENABLED=true` ใน Preview เพื่อให้ผู้มีสิทธิ์เมนู `barcodes` เห็น Wizard
3. ทดสอบ V1 characterization และ authenticated smoke test ของ Receive, Dispense, Borrow, Lend, mobile, LIFF และ Agent
4. ตั้ง `BARCODE_LEARNING_V2_RUNTIME_ENABLED=true` เฉพาะเมื่อ regression gate ผ่านแล้ว

หาก flag ใดไม่ถูกตั้งค่า ระบบเดิมยังอ่าน `barcode_patterns` ด้วยลำดับและผลลัพธ์เดิม ส่วน V2 ที่ตรวจไม่ครบจะอยู่ `DRAFT` และเปิดใช้ไม่ได้

## Invariant สำคัญ

- GS1 และ custom V1 ที่หา Master ได้ return ก่อนเสมอ
- V2 ทดลองเฉพาะกรณีที่ V1 หา Master ไม่พบ และไม่ทดลองกับ GS1 ที่หา GTIN ไม่พบ
- Runtime/regex/cache error เป็น fail-closed: กลับไป V1 หรือ manual input
- Pattern ที่เคย Active ปิดใช้ได้พร้อมเหตุผลและ audit แต่ลบถาวรไม่ได้
- Agent รุ่นเก่าไม่สนใจ field `v2Patterns`; Agent รุ่นใหม่ใช้ V2 เฉพาะ non-GS1 manual gap

## หน้าจอผู้ใช้

ที่ `/settings/barcodes` เลือก “รูปแบบใหม่ V2” แล้วทำตาม 4 ขั้น: ข้อมูลรูปแบบ → ตัวอย่างที่ 1 → ตัวอย่างที่ 2 → ตรวจสอบและบันทึกร่าง ระบบค้นหาตำแหน่งจากค่าที่ผู้ใช้คาดหวังให้เอง ไม่ต้องกดตัวอักษร QR ยาวทีละช่อง
