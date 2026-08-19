# WIP — 2026-08-19 22:45

## Git Status

```text
 M ψ/WIP.md
?? scripts/apply-v16-email-auth-registration.mjs
?? ψ/memory/retrospectives/2026-08/10/19.21_labstock-v5-commit-preview-deploy.md
?? ψ/memory/retrospectives/2026-08/11/
?? ψ/memory/retrospectives/2026-08/17/
?? ψ/memory/retrospectives/2026-08/19/22.45_qr-barcode-v2-v1-lock.md
```

## งานค้าง

- [ ] รัน `upgrade_v19_barcode_learning_v2.sql` ใน Neon Preview แล้วเปิด `BARCODE_LEARNING_V2_MANAGEMENT_ENABLED=true`
- [ ] ทำ authenticated regression ของ QR hardcode และ V1 จริงใน Receive, Dispense, Borrow, Lend, Mobile, LIFF และ Scanner Agent ก่อนเปิด V2 Runtime
- [ ] รัน authenticated smoke tests ของ Email Auth/PO export และ apply V17 ใน Neon staging ตาม WIP เดิม

## Context

- Commit `63f7213` เพิ่ม Barcode Learning V2 และ `6e587a2` ล็อก V1 write path; ทั้งคู่ push แล้ว และ Vercel Production `dpl_HuHr8tqvWfjZJc9C3MKhzdpPzPXS` Ready ที่ https://labstock-two.vercel.app
- Production V1 แสดง 13 patterns แบบ read-only; V2 management/runtime ยังปิด จึงยังเพิ่ม QR ใหม่ไม่ได้โดยตั้งใจ
- Preserve `scripts/apply-v16-email-auth-registration.mjs` และ retrospective เก่าที่ untracked; ห้าม stage โดยไม่มีคำสั่งผู้ใช้
