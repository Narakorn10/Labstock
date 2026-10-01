# WIP — 2026-10-01 13:44

## Git Status

```text
branch: update/desktop-shell (ล่วงหน้า origin 13 commit ยังไม่ push, PR #27 เปิดอยู่)
commit ล่าสุด: 3ac7a52 Update: Vendor portal shows ordered / received / outstanding per line
?? "ψ/memory/retrospectives/2026-10/"   (รอ commit)
 M "ψ/WIP.md"                          (รอ commit)
```

## งานค้าง
- [ ] ตัดสินใจ 3 ข้อจาก /scrutinize งานรับของ: (1) หมายเหตุตอนยืนยันรับบริษัทมองเห็น → ใส่ข้อความเตือน หรือซ่อน (2) ผู้ดูแลฐานข้อมูลรัน `SELECT id, po_id, quantity, received_qty, accepted_qty FROM purchase_order_items WHERE COALESCE(received_qty,0) <> COALESCE(accepted_qty,0);` ถ้ามีแถว ให้หน้าจอ/สูตรอิง `accepted_qty` (3) เตือนแล็บเรื่อง PO ค้างเลยกำหนดโดยไม่ผูก `SHIPMENTS_ENABLED` (ส่งแจ้งเตือน ต้องขออนุมัติ)
- [ ] ผู้ใช้ตรวจหน้าจริงที่ยังไม่ได้ดู: Settings, Notifications, Vendor Orders, ปุ่ม "ยืนยันรับของ" ใน `/orders/[id]` (ห้ามกดธุรกรรมที่ไม่ตั้งใจ)
- [ ] ถามผู้ใช้ก่อน push 13 commit เข้า PR #27 (ยังไม่ได้รับอนุญาต)
- [ ] ปรับหน้านโยบายสั่งซื้อน้ำยา `/settings/reagent-orders` ตามต้นแบบ (หน้าสุดท้าย)
- [ ] ตั้ง `hookTimeout` ใน `vitest.config.ts` (เทสต์ฐานข้อมูลจำลอง timeout เป็นบางรอบ)
- [ ] เก็บกวาด: `.env.local.bak-before-authsecret` (gitignore) และ dev server พอร์ต 3100 ที่อาจยังรันอยู่
- [ ] งานค้างเดิม: ตรวจ `/activity`, ใบงาน #31/#1, แจ้งเตือน Vendor + log cron outbox, ใบสั่งซื้อค้าง 5 ใบ, สรุปรายสัปดาห์ 2026-10-05, ขยาย `trackRoute`, ชื่อหน่วยงานใน hero, badge ข้างเมนู, เครื่องหมาย +/- ใน Logs

## Context
- `SHIPMENTS_ENABLED = false` (`src/lib/feature-flags.ts`) ซ่อนเมนู Receive from Vendor / Vendor Shipments โดยตั้งใจ; flow ใหม่ให้แล็บกด "ยืนยันรับของ" ที่ `/orders/[id]` (ไม่มี migration, ไม่แตะสต๊อก ไม่แจ้งเตือน) และ v29 (ตาราง `departments`) ผู้ใช้รันแล้ว
- ต้นแบบ `Desktop/design_handoff_labstock`; ตัวจับภาพเทียบหายแล้ว ต้องสร้างใหม่ถ้าจะเทียบภาพ; ไฟล์ส่วนใหญ่เป็น CRLF (แก้ด้วยสคริปต์ที่คงปลายบรรทัดเดิม)

---

## (history) Forward Handoff — 2026-09-07 23:33

### Current Git Status

```text
 M next.config.ts
 M package-lock.json
 M package.json
 M src/app/api/dashboard/route.ts
 M src/app/api/purchase-orders/[id]/route.ts
 M src/app/api/purchase-orders/route.ts
 M src/app/api/settings/route.ts
 M src/app/api/tracking/[trackingNo]/route.ts
 M src/app/borrow/page.tsx
 M src/app/count/page.tsx
 M src/app/dispense/page.tsx
 M src/app/layout.tsx
 M src/app/lend/page.tsx
 M src/app/login/page.tsx
 M src/app/orders/[id]/page.tsx
 M src/app/orders/page.tsx
 M src/app/page.tsx
 M src/app/receive/page.tsx
 M src/app/settings/barcodes/page.tsx
 M src/auth.ts
 M src/components/app-shell.tsx
 M src/components/auth-provider.tsx
 M src/components/inventory-overview.tsx
 M src/components/liff-dispense-workflow.tsx
 M src/components/mobile-stock-workflow.tsx
 M src/components/qr-scanner.tsx
 M src/lib/api-client.ts
 M src/lib/auth-utils.ts
 M src/lib/notifications.ts
 M src/lib/purchase-order-creation.ts
 M src/lib/purchase-order-export.test.ts
 M src/lib/purchase-order-export.ts
?? public/images/
?? scripts/apply-v16-email-auth-registration.mjs
?? src/app/api/auth/password-reset/
?? src/app/api/count-work-orders/
?? src/app/api/purchase-orders/ai-review/
?? src/app/count/work-orders/
?? src/app/dashboard/
?? src/app/reset-password/
?? src/components/lazy-qr-scanner.tsx
?? src/lib/auth-service.ts
?? src/lib/count-work-orders.test.ts
?? src/lib/count-work-orders.ts
?? src/lib/purchase-order-ai-review.test.ts
?? src/lib/purchase-order-ai-review.ts
?? src/lib/request-observability.ts
?? upgrade_v20_password_reset.sql
?? upgrade_v21_purchase_order_ai_reviewer.sql
?? upgrade_v22_count_work_orders.sql
?? upgrade_v23_formal_purchase_orders.sql
?? vitest.config.ts
?? "ψ/memory/retrospectives/2026-08/10/19.21_labstock-v5-commit-preview-deploy.md"
?? "ψ/memory/retrospectives/2026-08/11/"
?? "ψ/memory/retrospectives/2026-08/17/"
?? "ψ/memory/retrospectives/2026-08/23/"
```

### งานค้าง

- [ ] Run real authenticated LIFF Order/Dispense smoke tests on Preview without mutating live stock.
- [ ] Verify deployment `AUTH_SECRET`, then obtain approval before Production v20 migration.
- [ ] Selectively stage approved work, commit, and push only after release gates pass.
- [ ] Continue the separate count-work-order migration/UI work only with its own migration approval.

### Context

- Neon Preview `br-shiny-dream-aoh0iljd` has v20 applied and verified; Production does not have `session_version` or `password_reset_tokens`.
- Admin/Manager/Vendor Preview smoke, Auth.js session, password reset, session invalidation, lint, TypeScript, 75 tests, and build passed; temporary test data was removed.
- Preserve unrelated dirty work and do not deploy/push until LIFF and deployment-secret gates are verified.

---

## Previous Git Status

```text
 M package-lock.json
 M package.json
 M src/app/count/page.tsx
 M src/app/layout.tsx
 M src/app/login/page.tsx
 M src/app/orders/page.tsx
 M src/app/page.tsx
 M src/auth.ts
 M src/components/app-shell.tsx
 M src/components/auth-provider.tsx
 M src/components/inventory-overview.tsx
 M src/lib/api-client.ts
 M src/lib/auth-utils.ts
 M src/lib/notifications.ts
 M "ψ/WIP.md"
?? public/images/
?? scripts/apply-v16-email-auth-registration.mjs
?? src/app/api/auth/password-reset/
?? src/app/api/count-work-orders/
?? src/app/api/purchase-orders/ai-review/
?? src/app/count/work-orders/
?? src/app/dashboard/
?? src/app/reset-password/
?? src/lib/auth-service.ts
?? src/lib/count-work-orders.test.ts
?? src/lib/count-work-orders.ts
?? src/lib/purchase-order-ai-review.test.ts
?? src/lib/purchase-order-ai-review.ts
?? upgrade_v20_password_reset.sql
?? upgrade_v21_purchase_order_ai_reviewer.sql
?? upgrade_v22_count_work_orders.sql
?? vitest.config.ts
?? "ψ/memory/retrospectives/2026-08/10/19.21_labstock-v5-commit-preview-deploy.md"
?? "ψ/memory/retrospectives/2026-08/11/"
?? "ψ/memory/retrospectives/2026-08/17/"
?? "ψ/memory/retrospectives/2026-08/23/"
?? "ψ/memory/retrospectives/2026-09/"
```

## งานค้าง

- [ ] เพิ่ม UI เปลี่ยน/แบ่ง Lot สำหรับใบงานนับสต็อกทั้งมือถือและเดสก์ท็อป พร้อมทดสอบกรณี Lot ไม่พอ
- [ ] แก้หรือประสาน TypeScript error เดิมใน `src/auth.ts`; จากนั้นรัน type-check/build และ authenticated role smoke tests
- [ ] ขออนุมัติก่อน apply `upgrade_v22_count_work_orders.sql`; ห้าม deploy หรือหักสต็อกจริงก่อนผ่าน release gate

## Context

- Local `/count` และ `/api/auth/session` ตอบ HTTP 200 เมื่อรัน dev process ด้วย secret ชั่วคราวใน process เท่านั้น; `.env.local` ยังต้องตั้งค่า Auth secret สำหรับการ restart ปกติ
- Work-order API/transaction และ migration ถูกสร้างแล้ว แต่ migration ยังไม่ถูก apply; ผู้ใช้ไม่อนุมัติ commit/deploy
- Preserve unrelated dirty work; stage เฉพาะ paths ที่ผู้ใช้อนุมัติ
