# WIP — 2026-09-07 19:11

## Git Status

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
