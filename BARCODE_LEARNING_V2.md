# QR/Barcode Learning V2

V2 เป็นระบบเสริมที่แยกจาก `barcode_patterns` เดิมทางกายภาพ และเปิดใช้ถาวรแล้ว (ไม่มี env flag อีกต่อไป)

## การเปิดใช้

- ตาราง `barcode_pattern_v2` และ `barcode_pattern_v2_audit` มาจาก `upgrade_v19_barcode_learning_v2.sql` ซึ่งรันใน production แล้ว
- ผู้ที่มีสิทธิ์เมนู `barcodes` เข้าหน้า Wizard ได้เสมอ และกด "เปิดใช้" รูปแบบที่ผ่านการตรวจสอบได้ทันที
- `BARCODE_LEARNING_V2_MANAGEMENT_ENABLED` และ `BARCODE_LEARNING_V2_RUNTIME_ENABLED` เลิกใช้แล้ว ลบออกจาก Vercel ได้
- จะปิด V2 ทั้งระบบให้ "ปิดใช้" ทุกรูปแบบที่เปิดอยู่ (runtime ส่งเฉพาะสถานะ `ACTIVE`)

## Invariant สำคัญ

- GS1 และ custom V1 ที่หา Master ได้ return ก่อนเสมอ
- V2 ทดลองเฉพาะกรณีที่ V1 หา Master ไม่พบ และไม่ทดลองกับ GS1 ที่หา GTIN ไม่พบ
- Runtime/regex/cache error เป็น fail-closed: กลับไป V1 หรือ manual input
- Pattern ที่เคย Active ปิดใช้ได้พร้อมเหตุผลและ audit แต่ลบถาวรไม่ได้ (ลบได้เฉพาะที่ยังไม่เคยเปิดใช้)
- Agent รุ่นเก่าไม่สนใจ field `v2Patterns`; Agent รุ่นใหม่ใช้ V2 เฉพาะ non-GS1 manual gap

## หน้าจอผู้ใช้

ที่ `/settings/barcodes` เลือก “รูปแบบใหม่ V2” แล้วทำ 3 ขั้น:

1. **QR ชิ้นที่ 1** ตั้งชื่อ สแกน QR แล้วแตะตัวอักษรแรกและตัวสุดท้ายของรหัสสินค้า / Lot / วันหมดอายุ (พิมพ์เองก็ได้)
2. **QR ชิ้นที่ 2** สแกนน้ำยาเดียวกันคนละ Lot ระบบอ่านค่าตามตำแหน่งจากชิ้นที่ 1 ให้เอง ผู้ใช้แค่ตรวจว่าตรงฉลาก
3. **บันทึก** ถ้าผ่านการตรวจสอบกด "บันทึกและเปิดใช้" ได้ในปุ่มเดียว ถ้ายังไม่ผ่านบันทึกเป็นฉบับร่างไว้ทำต่อ
