# WIP — 2026-09-29 21:55

## Forward Handoff — 2026-09-29 21:55 (ต่อจากนี้: รอผู้ใช้ preview PR #27 desktop redesign)

### Git Status
```text
branch: docs/session-2026-09-28 (PR #26 เปิดอยู่ ยังไม่ merge) — งานโค้ดอยู่ที่ branch update/desktop-shell (PR #27 เปิดอยู่, push แล้ว, working tree สะอาด)
?? "ψ/memory/retrospectives/2026-09/29/"   (รอ commit บน branch นี้)
 M "ψ/WIP.md"                              (รอ commit บน branch นี้)
```

### งานค้าง
- [ ] ผู้ใช้ preview PR #27 (https://stocklabspr-git-update-desktop-shell-narakorn10s-projects.vercel.app ดูอย่างเดียว ห้ามกดธุรกรรม) แล้วบอกหน้าที่ต้องแก้; แก้ต่อบน branch `update/desktop-shell`; ไม่ทำ: badge ข้างเมนู, ตัวสลับ role/บัญชีเดโม, กราฟ Analysis/RBAC matrix/รายละเอียดใบสั่งซื้อ (แค่เปลี่ยนสี)
- [ ] เปิด `/activity` บน production หลังทำรายการ 1 ครั้ง ให้ตรวจแถวใน `app_events`
- [ ] 6928 ยืนยันเบิกใบงาน #31 ใหม่; 5783 ยกเลิกใบงาน #1
- [ ] ทดสอบแจ้งเตือน Vendor (PR #21) และ log cron outbox 02:00 UTC
- [ ] ใบสั่งซื้อค้าง 5 ใบเตือนครั้งสุดท้าย 09-30 แล้วหยุด; ผู้ใช้ตัดสินใจปิดใบเก่า
- [ ] สรุปรายสัปดาห์ ดูรอบ 2026-10-05 15:00 ไทย
- [ ] ขยาย `trackRoute` ไป login/ใบสั่งซื้อ/LIFF

### Context
- ทั้งหมดของวันนี้ merge แล้ว ยกเว้น PR #26 (เอกสาร) และ #27 (redesign); รายละเอียดและบทเรียน: `ψ/memory/retrospectives/2026-09/29/21.55_rich-menu-bugfixes-monitoring-desktop-redesign.md`
- Preview ใช้ฐานข้อมูล production; ตัวจับภาพ UI (playwright-core + mock `/api/**`) อยู่ใน scratchpad ของ session นี้ ไม่ได้ commit

---

## (history) อัปเดตท้ายวัน 2026-09-29 (เก็บไว้)

## Forward Handoff — 2026-09-29 ท้ายวัน (แก้บั๊ก 3 จุด + ระบบบันทึกกิจกรรม; merge ครบ #21–#25)

### สิ่งที่ทำวันนี้ (ทั้งหมด merge เข้า `main` แล้ว ยืนยันด้วย `git merge-base --is-ancestor`)
- **PR #21** แจ้งเตือนสต็อกต่ำ/ใกล้หมดอายุรั่วให้ Vendor เห็นน้ำยาบริษัทอื่น (`stock-transactions.ts`, `expiring-soon/route.ts` ไม่กรอง role/vendor) → Vendor เห็นเฉพาะของตัวเอง; DB มี Vendor 2 บัญชีที่เปิดรับทั้งสองแจ้งเตือน
- **PR #22** ยืนยันเบิกจากใบงานนับได้เฉพาะใบที่มี 1 รายการ: `SELECT COUNT(*) = (SELECT COUNT(*) FROM requirements)` ไม่มี FROM ทำให้ COUNT เป็น 1 เสมอ (พิสูจน์ด้วย SQL) → user 6928 และ 5783 เบิกไม่ได้ ขึ้น "ยอดจัดสรร Lot ต้องครบ…"; แก้ให้เบิกเฉพาะรายการที่ส่งมา ใบงานที่เหลือเปิดค้าง เทสต์ `count-work-orders.db.test.ts`
- **PR #23** ตาราง `app_events` (migration `upgrade_v28_app_events.sql`, **รันบน production แล้ว**) + `trackRoute` ใน `src/lib/app-events.ts` บันทึกใคร/ทำอะไร/สถานะ/ข้อความ error/สรุปข้อมูล (allowlist ไม่เก็บ pin/token) ใช้กับ count-work-orders, dispense, receive, mobile/confirm
- **PR #24** หน้า Admin `/activity` (เมนู `activity`), API `/api/app-events`, ปัญหาที่เกิดซ้ำ 7 วัน, ลบข้อมูลเก่ากว่า 90 วันตอน Admin เปิดหน้าแรก
- **PR #25** cron `outbox` ของ Vercel เรียก GET แต่ GET เป็นแค่รายงาน ไม่ส่งข้อความ → GET ที่มี `CRON_SECRET` ส่งคิวจริง (ตอนตรวจ DB คิวว่าง 91 แถว DELIVERED ทั้งหมด)
- retrospectives 25/26/27 commit แล้วบน branch นี้

### งานค้าง
- [ ] เปิด `/activity` ดูหน้าจอจริง แล้วเบิก/นับ 1 ครั้งเพื่อยืนยันว่ามีแถวใน `app_events` (ยังไม่ได้ดูหน้าจอ ยังไม่ทดสอบบน production)
- [ ] ให้ 6928 ลองยืนยันเบิกใบงาน #31 ใหม่ (ไม่ต้องยกเลิก); ให้ 5783 **ยกเลิกใบงาน #1** (ค้างตั้งแต่ 09-14 ยอดนับเก่า)
- [ ] ทดสอบแจ้งเตือนสต็อกต่ำ/ใกล้หมดอายุของ Vendor หลัง #21 (ผู้ใช้จะทดสอบภายหลัง)
- [ ] ดู log Vercel ของ cron outbox รอบ 02:00 UTC ว่าได้ 200 และมี `claimed`
- [ ] เตือน VENDOR_RESPONSE_OVERDUE: 5 ใบ SUBMITTED (PO-20260811-002/-003/-004, PO-20260831-001, PO-20260916-002) ไม่มี `vendor_response_due_at` ส่งวันละ 15 ข้อความ (5 ใบ × 3 คน) ตามเพดาน 3 ครั้ง/ใบ (`purchase-order-overdue.ts:10`): ส่งไปแล้ว 09-28, 09-29 ครั้งสุดท้าย 09-30 แล้วหยุดเอง; ผู้ใช้ตัดสินใจว่าจะปิด/ยกเลิกใบเก่าไหม
- [ ] ผลสรุปรายสัปดาห์ (ยังไม่ยืนยันว่าส่งถึงคนจริงไหม): ดูรอบจันทร์ 2026-10-05 15:00 ไทย
- [ ] ขยาย `trackRoute` ไป login (ระวัง PIN/รหัสผ่าน), ใบสั่งซื้อ, LIFF; เทียบ Sentry ทีหลังถ้าต้องการ stack trace
- [ ] ที่ค้างเดิมด้านล่าง (desktop redesign, Vendor rich menu, `mobile/lookup` ไม่ล็อกอิน ฯลฯ)

### บทเรียน
- route ที่ catch แล้วคืน 400 ไม่มี log ฝั่งเซิร์ฟเวอร์ จึงหาสาเหตุย้อนหลังไม่ได้ → ใช้ `app_events`
- SQL `SELECT COUNT(*) = (...)` ที่ไม่มี FROM ให้ COUNT เป็น 1 เสมอ; เขียนเทสต์บน Postgres จำลอง (PGlite) แล้วยืนยันว่าล้มกับโค้ดเดิมก่อนแก้
- ไฟล์ส่วนใหญ่ใน repo เป็น CRLF: สคริปต์แก้ไฟล์ต้องรักษา EOL เดิม (grep `$'\r'` ใน Git Bash ไม่เชื่อถือได้ ใช้ node ตรวจ)

---

<!-- ด้านล่างคือ handoff เช้า 2026-09-29 (เก็บไว้ ไม่ได้ลบ) -->

## Forward Handoff — 2026-09-29 (มือถือ/LINE + rich menu ขึ้น production แล้ว เบิกผ่าน LIFF ทดสอบสำเร็จ)

### Rich menu rollout — เสร็จ 2026-09-29 (PR #19, #20 merged; เฟส 6 ปิด)
- สร้างเมนูใหม่ใน LINE ด้วย `create` (ไม่ลบเก่า): receive+dispense+web `richmenu-e89843676a73d162658ce95430b6af16` (`LINE_RECEIVE_RICH_MENU_ID`), dispense+web ไม่มีรับเข้า `richmenu-e28fca146a2c3d91b991d905867fbf14` (`LINE_DISPENSE_RICH_MENU_ID` และ default ของ LINE ตั้งแล้ว), purchasing 4 ช่อง สั่ง/รับเข้า/เบิก/เว็บ `richmenu-7cc4c0326e4b53ee549d4711417b5fa2` (`LINE_PURCHASING_RICH_MENU_ID`)
- ผู้ใช้รัน `default` และ `sync` เอง (ระบบสิทธิ์ของ Claude Code บล็อกการเขียนเมนู LINE ทั้งระบบ): ผูก Admin 2, Manager 1 → purchasing; User 1 → receive; Operator/Vendor ไม่มีบัญชี LINE
- ผู้ใช้ยืนยันว่า LINE แสดงเมนู 4 ช่องแล้ว; ยังไม่ยืนยันการกดปุ่ม "รับเข้า" เปิด `/mobile/receive` และยังไม่ยืนยันว่าค่า `LINE_PURCHASING_RICH_MENU_ID` ใน Vercel เป็น ID ล่าสุด (`…7cc4…`) + redeploy แล้ว (มีผลกับคนผูกบัญชีใหม่)
- เหตุที่ต้องทำ PR #20: เมนู purchasing 3 ช่องแรก (#19) ไม่มีปุ่มรับเข้า แต่ Admin/Manager มีสิทธิ์รับเข้า → หลัง `sync` ปุ่มรับเข้าหาย
- Rollback (ID เก่า): dispense `richmenu-0147218be85e50cb1bcd43ad3c3d6ecf`, purchasing เดิม `richmenu-96289d3ca640b431513b004c06af684d`, purchasing 3 ช่อง `richmenu-31b2fe7b9242fa26d04788d7d898f9f3`; ใช้ `link <lineUserId> <id>` / `default <id>`
- สถานะ repo ในเครื่อง: detached ที่ `4ebb56f` (origin/main); `main` ในเครื่องต่างจาก GitHub (ไม่ได้แตะ)

### สถานะ
- ผู้ใช้ merge PR #12–#17 เมื่อ 2026-09-29 (08:04Z) แต่ #14, #15, #16 ถูกรวมเข้า branch ฐานของตัวเอง ไม่ใช่ `main` (ไม่ได้ลบ branch ของ #13 GitHub เลยไม่ย้าย base) → เปิด PR #18 (`update/mobile-home-workflow` → `main`) merge 08:09Z; ยืนยันด้วย `git merge-base --is-ancestor` ว่า `da58b99 921cda0 ed4b167 519615f` อยู่ใน `main`
- Vercel production Ready; probe ไม่ล็อกอิน: `/login` `/mobile` `/liff/dispense` 200, `/api/mobile/confirm` GET 405
- ผู้ใช้ทดสอบเบิกผ่าน LIFF บน production: สำเร็จ (ผู้ใช้รายงาน ไม่ทราบบัญชี/รายการที่ใช้ทดสอบ)
- PR #19 (rich menu 3 แบบ + สคริปต์ create/link/default/sync, ใช้ `roleHasMenu` ของ #12) และ #20 (purchasing 4 ช่อง) merge แล้ว; vitest 174 ผ่าน

### งานค้าง
- [ ] ตรวจใน Vercel production: `LINE_PURCHASING_RICH_MENU_ID` = `…7cc4…` แล้ว redeploy; กดปุ่ม "รับเข้า" ใน LINE ว่าเปิด `/mobile/receive`
- [ ] ยังไม่ทดสอบใน LINE จริง: ผูกบัญชี PIN 4/6 หลัก, อนุมัติ PO ผ่าน LIFF, กล้องสแกน, การ์ด Flex
- [ ] Rich menu Vendor (3b) เลื่อนไปรอบหน้า
- [ ] ผู้ใช้ตัดสินใจ desktop redesign (เสนอ 4 PR, แทนสี Tailwind ~1,480 จุด)
- [ ] ลบ `.next/dev/cache.stale-bak` เมื่อสะดวก
- [ ] ค้างจากรอบ 26 ก.ย.: ดู history ด้านล่าง

### บทเรียน
- PR ซ้อนสาย (stacked): merge ตามลำดับแล้วต้อง "ลบ branch" ของใบก่อนหน้า ไม่งั้นใบถัดไปไปรวมเข้า branch เดิม ไม่เข้า `main` — หลัง merge ให้เช็กด้วย `git merge-base --is-ancestor <commit> origin/main`

---

## (history) Handoff 2026-09-28 23:36 — เก็บไว้ ไม่ได้ลบ (PR มือถือ/LINE เปิดแล้ว รอ merge + ทดสอบใน LINE จริง)

### Git Status
```text
branch: update/line-flex-design (== origin, PR #17)
 M "ψ/WIP.md"
?? "ψ/memory/retrospectives/2026-09/25/"
?? "ψ/memory/retrospectives/2026-09/26/"
?? "ψ/memory/retrospectives/2026-09/27/"
?? "ψ/memory/retrospectives/2026-09/28/"
```

### งานค้าง
- [ ] ทดสอบใน LINE จริง: PR #16 (LIFF ผูกบัญชี PIN 4/6 หลัก, เบิก, อนุมัติ PO, กล้องจริง) และดู Flex ของ PR #17 ใน LINE Flex Message Simulator
- [ ] Merge ตามลำดับ: #12 (fix สิทธิ์) → #13 → #14 → #15 → #16; #17 อิสระ (ลบ branch ที่ merge แล้ว GitHub จะย้าย base ไป main เอง)
- [ ] เฟส 6 Rich menu (ทำหลัง #12 ขึ้น production): ทำ 2 ชุด (มีปุ่มรับเข้า / ไม่มีสำหรับ Operator), ขยาย `linkLineRichMenuForRole` (`src/lib/line-bot.ts:118`), ภาพผ่าน HTML + `msedge --headless --screenshot` 2500×843, สร้างเมนูใหม่ (ID ใหม่ ไม่ลบเก่า) ทดสอบบัญชีเดียวก่อน; Rich menu Vendor (3b) เลื่อนไปรอบหน้า
- [ ] ผู้ใช้ตัดสินใจ: ทำ desktop redesign ไหม (เสนอ 4 PR: โครงหน้า/เมนูข้าง → ภาพรวม/วิเคราะห์/logs → รับเข้า/เบิก/นับ/ยืม → ใบสั่งซื้อ/Vendor/master/settings) ต้องแทนสี Tailwind ตรง ๆ ~1,480 จุดทีละหน้า
- [ ] ลบ `.next/dev/cache.stale-bak` (แคช Turbopack ที่ย้ายทิ้ง) เมื่อสะดวก
- [ ] ยังค้างจากรอบ 26 ก.ย.: ดูส่วน history ด้านล่าง (ตรวจ cron, vendor 4 รายการ, รีวิวความปลอดภัย: `mobile/lookup` ไม่ล็อกอิน ฯลฯ)

### Context
- PR: #12 fix สิทธิ์ `mobile/confirm` · #13 ฟอนต์/token · #14 login · #15 `/mobile` · #16 LIFF · #17 Flex; ตัดสินใจแล้ว: Operator รับเข้าไม่ได้ (role_permissions ตรวจแล้ว มีแค่ Operator ไม่มี `receive`)
- แผนเต็ม: `~/.claude/plans/ethereal-snuggling-hamster.md`; Preview ของ Vercel อาจชี้ DB production ห้ามกดยืนยันบน Preview; retrospective: `ψ/memory/retrospectives/2026-09/28/23.36_mobile-line-redesign-prs.md`

---

## (history) Handoff เดิม 2026-09-26 — เก็บไว้ ไม่ได้ลบ

# WIP — 2026-09-26 11:28

## Forward Handoff — 2026-09-26 11:28 (after production deploy)

### Git Status
```text
branch: release/2026-09-26-po-and-auth (== origin, already merged to main via PR #9, c73c16c)
 M "ψ/WIP.md"
?? "ψ/memory/retrospectives/2026-09/25/"
?? "ψ/memory/retrospectives/2026-09/26/"
```

### งานค้าง
- [ ] ให้คนล็อกอินบน production ลองใช้จริง: Vendor ส่งของ → Lab รับของ (ครั้งแรกบน prod) และหน้าสั่งน้ำยาผ่าน LINE บนมือถือ
- [ ] ตรวจ cron รอบแรก (~08:30 น. ไทย; Vercel → Settings → Cron Jobs → Run) คาดว่าเตือน Lab ~5 ใบที่เลยกำหนดส่ง
- [ ] Admin ใส่บริษัทให้น้ำยา 4 รายการที่ไม่มี vendor (`/master`); ตั้งอายุคงเหลือขั้นต่ำตามต้องการ
- [ ] ตัดสินใจ: Operator ควรรับเข้าผ่านเว็บได้ไหม (ตอนนี้ 403) / backfill `vendor_response_due_at` ของใบ SUBMITTED เก่า 5 ใบ
- [ ] ค้างจากรีวิวความปลอดภัย: `mobile/lookup` ไม่ล็อกอิน, rate limit ล็อกอิน, bearer plaintext, cache `information_schema`
- [ ] ในเครื่อง: `git switch main && git pull`; commit/ทิ้ง `ψ/WIP.md` และโฟลเดอร์ retrospectives 25/26

### Context
- Production deploy สำเร็จ (Vercel READY, alias `labstock-two.vercel.app`); rollback = Promote deployment ก่อนหน้า; migration v26 ทำแล้ว ไม่ต้องย้อน
- รายละเอียดทั้งหมด: `ψ/memory/retrospectives/2026-09/26/11.28_po-lifecycle-auth-hardening-production-deploy.md` และส่วน "DEPLOYED TO PRODUCTION" ด้านล่าง (ส่วนล่างเป็นบันทึกเดิม เก็บไว้)

---

## ✅ DEPLOYED TO PRODUCTION 2026-09-26 ~04:26Z — PR #9 merged (merge commit `c73c16c`) → Vercel production deployment READY (`stocklabspr-9gree81rq…`, alias `labstock-two.vercel.app`)
Post-deploy probe (unauthenticated, no data changed): `/login` 200; new `/api/master/shelf-life` 401 and `/api/notifications/purchase-order-overdue` 401 (routes exist); `/api/receive` 401; `/api/logs` 401; `/api/telegram-webhook` 503 (fail-closed, no bot configured).
Not yet verified after deploy: authenticated flows (Vendor ship / Lab receive, LINE LIFF), first cron run (≈01:30 UTC next day = 08:30 Thai; Vercel → Settings → Cron Jobs → Run), Operator 403 on /api/receive. Rollback = Vercel Deployments → Promote previous deployment (v26 columns are harmless to old code).
TODO for people: Admin sets vendor on the 4 reagents with no vendor (/master); set min shelf-life days per reagent if wanted (/master, Admin/Manager); local `main` branch is stale → `git switch main && git pull`; `ψ/WIP.md` + retrospective folder still uncommitted locally.

## (history) PUSHED 2026-09-26: `origin/release/2026-09-26-po-and-auth` → PR #9 (https://github.com/Narakorn10/Labstock/pull/9) into `main`
Vercel project `stocklabspr`: git-connected to Narakorn10/Labstock, production branch = `main`. Push to a branch → Preview; merging a PR into `main` → Production (same pattern as PR #7/#8). Preview deploy of `3292019` = READY, PR checks pass. **Production deploy = merge PR #9 (not done yet, waiting for the user).** Scan for secrets before push was clean; no `ψ/` files were pushed (WIP.md still uncommitted locally).
After merge: watch the production deployment, then the watch list below.

## RELEASE BRANCH — `release/2026-09-26-po-and-auth` (was local-only at the time of writing this section)
`3292019` = merge of `feat/po-lifecycle-hardening` (10 commits) + `fix/auth-rbac-hardening` (4 commits), base `agent/reagent-order-suggestions` (`6e1d6aa`). No conflicts. On the merged result: vitest 131/131 (25 files), tsc, lint, build all pass.
State of the world before deploy: production Neon already has v26 columns (user applied); Vercel Production has `CRON_SECRET`, `AUTH_SECRET`, no TELEGRAM_* vars. `main` is far behind (`b5a267e`); `origin/agent/reagent-order-suggestions` = `6e1d6aa`. Deploy path (git push→Vercel vs `vercel --prod` from local) NOT decided with the user yet.
Caution: Vercel `DATABASE_URL` is listed for BOTH Preview and Production (value hidden) → a Preview deploy may talk to the production database; do not "test on Preview" with write actions until confirmed.
Post-deploy watch list: first real Vendor shipments/receipts (never used in prod before; exp_date DATE bug fixed); first overdue cron run reminds Lab about 5 overdue CONFIRMED POs; role_permissions: Operator gets 403 on /api/receive (menu absent); Google login now exact-email only; set vendor on the 4 reagents without one (/master).

## PO lifecycle hardening — branch `feat/po-lifecycle-hardening` (from `agent/reagent-order-suggestions`, not pushed)

Commits: `93489b4` status recompute fix · `9af9f2b` atomic Vendor response / Lab revision review · `e116077` PO number in txn ·
`f1a03c3` `scripts/repair-po-status.mjs` (dry-run default) · `d16ad5c` CANCEL / CLOSE_SHORT · `c6519c3` overdue reminders cron ·
`fcf0e11` min shelf life (migration `upgrade_v26_min_shelf_life.sql`).
Verified locally: vitest 102/102 (incl. PGlite real-Postgres tests `*.db.test.ts`), tsc, lint, build.
Plan deviation: CANCEL allowed only SUBMITTED/ACKNOWLEDGED/REVISION_REQUESTED/CONFIRMED (PENDING_MANAGER_REVIEW uses existing reject); CLOSE_SHORT only PARTIALLY_RECEIVED.

### User report 2026-09-26: "cannot add the reagent I want after the bot suggests" — fixed in `6a98f75`
Root cause: shared suggestion query returned only reagents with an enabled `reagent_order_policy` (and LIMIT ≤100). LINE search never found no-policy reagents; web picker (from /api/dashboard) showed them but PO creation rejected with "Every item must belong to the selected Vendor.". User decision: allow them, reason mandatory. Now: search + creation include them flagged `NO_ORDER_POLICY` (always MANUAL + reason, badge for Manager on /orders/[id]); auto-suggest unchanged; creation checks exactly submitted item IDs; clear Thai validation errors (duplicate reagent); web picker blocks duplicates.
Verified: vitest 109/109 (new `src/lib/purchase-order-unconfigured.db.test.ts`; 5/7 fail on old code), tsc, lint, build. Not yet: Neon test-branch smoke, LINE UI on a phone, production count of affected reagents.
- Production counts (user query 2026-09-26): only 1 no-policy/disabled-policy reagent (E for L Aim), but **PCL has 116 active reagents** → the real main cause was the row cap (lowest-stock first): PO creation checked only first 100 (16 PCL reagents unorderable → fixed by itemIds in `6a98f75`); LINE auto-suggest evaluated 30, web auto-suggest/AI review 100, LINE browse listed 30 → fixed in `50a41df` (auto-suggest evaluates all, browse 300, search 50). 112/112 tests; 2 new tests fail without the fix.
- Data issue for Admin (no code): 4 active reagents have NO vendor in master_data → cannot be ordered from any Vendor until a vendor is set on /master.

### Neon test-branch smoke test — 2026-09-26 (PASSED)
Branch `test-po-lifecycle-2026-09-26` (`br-proud-hat-aoi29m00`, endpoint `ep-patient-wildflower-ao6a3iq3`) copied from production; v26 applied there only; notification addresses nulled on the branch; LINE creds dummied. Ran built app on :3200 with bearer-token test users.
- Ship full → SHIPPED; Lab receive → RECEIVED + received_at; partial ship/receive with reject → PARTIALLY_RECEIVED; cancel in-transit shipment → status recomputed
- CLOSE_SHORT refused while in transit, needs reason, then Vendor cannot ship (409); Lab CANCEL works, Vendor CANCEL → 409
- Shelf life: Vendor 30-day lot vs 90-day rule → 409; Lab receive needs exception reason (stored in `shipments.shelf_life_override_reason`); Vendor cannot read/change rule (403)
- Vendor acknowledge → revision → Lab approve applies qty; stale repeat → 409; 3 concurrent PO creates → -002/-003/-004 unique
- Overdue cron: 401 for Vendor/wrong secret, reminded overdue POs once, 0 on second run; no outbox rows created (no addresses)
- Production-copy findings: **0 real shipments / shipment_batches ever** (shipment stage never used in prod; consistent with the exp_date DATE bug 500), 21 POs (CONFIRMED 11, SUBMITTED 5, REJECTED 5). `repair-po-status.mjs` dry run on the branch: 0 need repair.
- 5 real CONFIRMED POs are past expected_date → first prod cron run sends 5 DELIVERY_OVERDUE reminders to Admin/Manager. The 5 SUBMITTED POs have NULL `vendor_response_due_at` (old code only set it on ACKNOWLEDGE) → no response-overdue reminders for them unless backfilled.
- Live proof of the auth hole on this base: Vendor token got 200 on POST /api/receive and GET /api/logs (RBAC fix is only on `fix/auth-rbac-hardening`). `git merge-tree` shows the two branches merge without conflicts.
- Test branch `br-proud-hat-aoi29m00` DELETED 2026-09-26 at user's request (verified: only `production` and archived `preview` remain). Local test server stopped.

### Before deploy (all need user approval)
- [x] Smoke test full flow on a Neon **test branch** (not production); apply v26 there first
- [x] `exp_date` on production is DATE in both `shipments` and `inventory` (user query 2026-09-26). This exposed a pre-existing bug since `700c5ac` (2026-07-27): Vendor shipment insert wrote text into DATE → every submission 500. Fixed in `b859a3f`; PGlite schema now DATE.
- [ ] Run `node scripts/repair-po-status.mjs` (dry run) against production, review, then `--apply`
- [x] v26 applied on production by the user (Neon SQL Editor) 2026-09-26; verified read-only: `master_data.min_shelf_life_days` integer, `shipments.shelf_life_override_reason` text. (The assistant's own attempt was blocked by the permission classifier as "Production Deploy" and was not retried.) No rules are set yet → the shelf-life check stays off until an Admin/Manager sets days per reagent on /master.
- [x] `CRON_SECRET` already exists in Vercel Production (`stocklabspr`, created 74d ago; checked with `vercel env ls production` 2026-09-26, names only) → new cron needs nothing extra. `AUTH_SECRET` also present.
- [x] Vercel Production has NO `TELEGRAM_BOT_TOKEN` and NO `TELEGRAM_WEBHOOK_SECRET` → the Telegram bot is not configured in production, so the 503 fail-closed change in `fbf9a28` cannot break a working bot (remaining assumption: the bot is not hosted elsewhere pointing at this URL).
- Auth branch `fix/auth-rbac-hardening` is separate; still blocked on `TELEGRAM_WEBHOOK_SECRET`

## Reagent ordering review — 2026-09-26 (read-only, no code changed)

- **CONFIRMED bug (PGlite proof in session scratchpad):** PO status CTEs read the pre-statement snapshot, so status lags one step.
  Ship 10/10 → stays `CONFIRMED` (should be `SHIPPED`); accept 10/10 → `PARTIALLY_SHIPPED` (should be `RECEIVED`), `received_at` stays NULL. Inventory and `accepted_qty` are correct.
  Files: `src/app/api/vendor/shipments/route.ts:124-133`, `src/app/api/vendor/shipments/[id]/route.ts:30-47` (cancel), `:88-97` (receive).
- Web revision approve/reject (`src/app/api/purchase-orders/[id]/route.ts:302-313`) has no status guard and is not in a transaction (LIFF version `src/app/api/liff/orders/[id]/route.ts:34-50` is).
- Vendor revise/confirm writes item rows before the status CAS (`purchase-orders/[id]/route.ts:144-203`) → partial writes on 409.
- `generatePONumber` = COUNT+1 (`src/lib/purchase-order-creation.ts:37-45`) → duplicate number race / reuse after delete (column is UNIQUE → 500).
- Next: user decides scope; check production for affected POs (query in chat).

## Forward Handoff — 2026-09-26 (auth/RBAC fixes)

Branch: `fix/auth-rbac-hardening` (จาก `agent/reagent-order-suggestions`) ยังไม่ push / ไม่ deploy

- `c11225a` receive/dispense/logs ใช้ `hasMenuPermission` (401/403)
- `0390df0` google-token จับคู่อีเมลตรงตัวผ่าน `findActiveUserByEmail`
- `fbf9a28` Telegram webhook ตอบ 503 ถ้าไม่ได้ตั้ง `TELEGRAM_WEBHOOK_SECRET`
- `7dc8fc8` อัปเกรด hash SHA-256 เป็น bcrypt หลังล็อกอินสำเร็จ
- ตรวจแล้ว: vitest 97/97, `tsc --noEmit`, lint, `npm run build` ผ่าน
- Smoke test `next start` ในเครื่อง โดยตั้ง `DATABASE_URL` ปลอมเพื่อไม่แตะ production: ไม่ล็อกอิน → receive/dispense/logs/google-token ได้ 401, Bearer ปลอม → 401, Telegram ไม่มี secret → 503
- ⚠️ `.env.local` ชี้ไปที่ Neon **production** (`ep-dawn-darkness-aoioxef6`, branch `production`) ส่วน branch `preview` ถูก archive แล้ว ห้ามรัน dev ปกติเพื่อทดสอบการเขียนข้อมูล
- ยังไม่ได้ทดสอบ: ล็อกอินจริงแบบมี role (403/200) และการอัปเกรด hash ต้องใช้ Neon branch ทดสอบ
- ตัดทิ้ง: ความเสี่ยงรับเข้าซ้ำจาก `notifyUsers` ไม่มีจริง (เรียกด้วย settings `[]`)

### ด่านก่อน deploy
- [x] `role_permissions` production (ผู้ใช้ส่งผลมา 2026-09-26): Admin/Manager/User มีครบ; Operator มี `dispense`,`logs` แต่ไม่มี `receive` (sidebar ก็ไม่แสดงอยู่แล้ว จะได้ 403 เฉพาะถ้าเข้า `/receive` ตรง); Vendor ไม่มีทั้ง 3 เมนู
  - Operator ยังรับเข้าผ่าน `/mobile/receive` + PIN ได้ (`mobile/confirm` กันแค่ Vendor) — ผู้ใช้ตัดสิน 2026-09-26: คงไว้ ไม่แก้
- [x] **(คลายบล็อกแล้ว 2026-09-26: Vercel Production ไม่มีตัวแปร TELEGRAM_* เลย บอทไม่ได้ตั้งค่าใช้งาน — ดูข้อความด้านบน)** ~~บล็อก deploy:~~ production ยังไม่ได้ตั้ง `TELEGRAM_WEBHOOK_SECRET` (ผู้ใช้ยืนยัน 2026-09-26) ถ้า deploy `fbf9a28` ตอนนี้บอท Telegram จะได้ 503 ทุกข้อความ ต้องเลือก: (A) ตั้ง env + setWebhook `secret_token` ก่อน deploy, (B) ยืนยันว่าไม่ใช้บอทแล้ว, หรือ (C) แยก commit Telegram ออกจากรอบนี้; `.env.local` ไม่มีตัวแปร Telegram เลย
  - ผู้ใช้เลือก (A) 2026-09-26: ให้สคริปต์ `set-telegram-webhook-secret.ps1` (อยู่ใน scratchpad ของ session ไม่ได้อยู่ใน repo) ผู้ใช้รันเอง → เพิ่ม secret_token ให้ webhook เดิม + ใส่ `TELEGRAM_WEBHOOK_SECRET` ใน Vercel `stocklabspr` Production แล้วค่อย deploy
  - ตรวจหลังตั้ง: `GET /api/settings/notifications/telegram-status` ต้องได้ `hasWebhookSecret: true` (endpoint นี้ไม่ต้องล็อกอิน — ข้อมูลแค่ boolean/จำนวน ควรพิจารณาใส่ auth ภายหลัง)
- [ ] บัญชีที่เคยใช้ Google login โดย username ตรงกับส่วนหน้าอีเมล ต้องมี `email` ในตาราง users

### ยังไม่ทำ (นอกขอบเขต)
- `GET /api/mobile/lookup` ไม่ต้องล็อกอิน (หน้า `/mobile/*` ใช้ PIN ตอนยืนยัน ต้องออกแบบใหม่)
- rate limit ล็อกอิน, bearer token plaintext เก่า, cache `information_schema`, ยืนยัน `upgrade_v24`/`v25` บน production

---

## Forward Handoff — 2026-09-25 23:29 (codebase review)

### Git Status

```text
?? "ψ/memory/retrospectives/2026-09/25/"
```

Branch: `agent/reagent-order-suggestions` (no source files modified).

### งานค้าง

- [ ] ถามผู้ใช้ว่า role Vendor/อื่น ๆ ควรใช้ `receive`/`dispense`/`logs` ได้หรือไม่ แล้วเพิ่มเช็ค role + test (`src/app/api/receive/route.ts:7-10`, `dispense/route.ts:7-10`, `logs/route.ts:7-10`)
- [ ] ตัดสินใจว่า `GET /api/mobile/lookup` ต้องล็อกอินหรือไม่ (`src/app/api/mobile/lookup/route.ts:5`)
- [ ] ให้ `google-token` จับคู่ด้วยอีเมลตรงตัวเหมือน sign-in (`google-token/route.ts:42-50`); เพิ่ม rate limit ล็อกอิน; อัปเกรด SHA-256 เก่าเป็น bcrypt
- [ ] อ่าน `notifyUsers` เพื่อยืนยันหรือตัดความเสี่ยงรับเข้าซ้ำ (`src/lib/stock-transactions.ts:138-147`)
- [ ] รัน `npm run build` เมื่อเขียนทับ `.next/` ได้ และยืนยันว่า `upgrade_v24`/`v25` (มี `labstock_assert`) ถูก apply บน production ก่อน deploy

### Context

- รีวิวแบบอ่านอย่างเดียว ยังไม่ได้แก้โค้ด; lint, vitest 78/78 และ `tsc --noEmit` ผ่าน รายละเอียดใน `ψ/memory/retrospectives/2026-09/25/23.28_lab-stock-codebase-security-review.md`
- งานแก้ auth/RBAC เสี่ยงต่อ production: ขออนุมัติผู้ใช้ก่อน แยกเป็น PR เล็ก ๆ
- ส่วนด้านล่างคือ handoff เก่า (2026-09-07) เก็บไว้ อาจล้าสมัยแล้ว

---

## Earlier Handoff — 2026-09-07 19:11 (preserved)

## Forward Handoff — 2026-09-07 23:33

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
