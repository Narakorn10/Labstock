# LINE Webhook Department Scope (กลุ่ม 6 PR-C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เมื่อสวิตช์ `DEPARTMENTS_ENABLED` เปิด บอท LINE (`line-webhook`) ตอบสต็อก / PO / พัสดุเฉพาะผู้ใช้ที่ผูกบัญชีและเฉพาะข้อมูลที่มีสิทธิ์เห็น; ตอนสวิตช์ปิดต้องตอบเหมือนเดิมทุกไบต์.

**Architecture:** ด่าน `getLineBotAccess` (ใน `line-liff-ordering.ts` เพราะเป็นไฟล์เดียวที่ guard test อนุญาตให้เรียก `resolveDepartmentForLineUser`) + ตัวตัดสินแบบ pure `decideLineBotCommand` + คำค้น PO/พัสดุที่รับ `actor` บังคับใน `src/lib/line-bot-queries.ts` (แบบเดียวกับ `bot-stock-queries.ts`). webhook เหลือแค่เรียกสามอย่างนี้. สวิตช์ปิด → `actor: {kind:"legacy"}` ข้อความ SQL เดิมทุกตัวอักษร ไม่มี query เพิ่ม. คำค้น `purchase_order_items` **คงอยู่ใน route** (ข้อความมีการเยื้องในตัว template; ไม่ใช่ตารางแผนก; ดึงด้วย `po.id` ของแถวที่กรองแล้ว).

**Tech Stack:** Next.js 16 route handlers, `@neondatabase/serverless` (`neon`), `@line/bot-sdk`, vitest 4 + PGlite (`createPgliteSql`).

**Spec:** `docs/superpowers/specs/2026-10-26-line-webhook-department-scope-design.md` (อนุมัติโดยเจ้าของ 26 ต.ค.; มีส่วนเพิ่ม §5.5 ข้อ 5 จากการตรวจแผน). ตัวย่อด้านล่าง "spec §N".

## Global Constraints
- ลายเซ็นต้องตรวจก่อนเสมอ (`route.ts:121-129` ไม่เปลี่ยนลำดับ); ห้ามห่อ try/catch รอบ `Promise.all` ของ batch; ไม่แก้ SQL ของ postback (`:305-307`, `:327-335`), `ensureExpiryAcknowledgementSchema`, `ack_expiry`, และคำค้น `purchase_order_items` (`:220-224`).
- webhook ห้ามอ้างชื่อ `resolveDepartmentForLineUser` (guard `department-context.line-usage.test.ts`; `ALLOWED`/`FORBIDDEN` ไม่เปลี่ยน). ห้ามแตะ `src/lib/line-liff-auth.ts`. **ห้ามเขียนชื่อ `getLineBotAccess` หรือ `resolveDepartmentForLineUser` ในคอมเมนต์ของไฟล์อื่นนอกที่ spec กำหนด** (guard ใช้ `.includes`).
- ห้ามรัน `npm run dev` และ `npm run build` (หัวหน้าทีมรันเอง); เทสต์ใช้ PGlite เท่านั้น; ห้ามเปิดสวิตช์จริง (ใช้ `vi.stubEnv`); ไม่ commit `ψ/`; ไม่ push.
- ไม่มี migration ไม่มี env ใหม่. สไตล์: TS, 2 spaces, double quotes, semicolons, import `@/…`. commit ลงท้าย `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- ข้อความที่เจ้าของกำหนดตายตัว: ผูกแล้วไม่มีแผนก → `ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ`. ข้อความอื่นตาม spec §5.4 (คงความหมาย).
- ทุก commit ต้องผ่าน `npx vitest run src/lib/department-scope-coverage.test.ts src/lib/department-context.line-usage.test.ts` และ `npx tsc --noEmit -p .`.
- ห้าม regen baseline เพื่อให้เทสต์ผ่าน; ถ้า baseline ไม่ตรงให้แก้โค้ด.

## Review Focus
1. ผู้ใช้ไม่ผูก/`inactive`/ไม่มี `source.userId` พิมพ์ `PO-…`/เลขพัสดุ/สต็อก ตอนสวิตช์เปิด → ไม่ถึง query ข้อมูลใด ๆ; **ตอนสวิตช์ปิดต้องได้คำตอบเดิม** (Task 1, 4).
2. role ระดับระบบ Manager แต่ถูก override เป็น `User`/`Operator`/`Technician` ในแผนก → ถูกปฏิเสธ PO/พัสดุ แต่ใช้สต็อกได้ (Task 2, 4).
3. Vendor ที่ `users.vendor` ว่าง/เป็นช่องว่าง → "ไม่พบ" ไม่ query และไม่จับคู่กับ PO/พัสดุที่ `vendor = ''` (`users.vendor DEFAULT ''`; `purchase_orders.vendor`/`shipments.vendor` เป็น NOT NULL จึงไม่มีกรณี NULL) (Task 3).
4. Vendor พิมพ์ PO ของบริษัทตัวเองที่สถานะ `PENDING_MANAGER_REVIEW` → "ไม่พบ" เหมือนเว็บ (`purchase-orders/route.ts:63-64`, `[id]/route.ts:49`) (Task 3).
5. lab actor ที่ scope ไม่ใช่ `one` (legacy/all) หลุดเข้าฟังก์ชันค้น → ต้อง throw ไม่ใช่ไม่กรอง (Task 3).

---

### Task 1: baseline ของ webhook ตอนสวิตช์ปิด (จับจากโค้ดเดิมก่อนแตะ src)

**Files:**
- Create: `src/app/api/line-webhook/line-webhook.legacy.test.ts`, `src/app/api/line-webhook/line-webhook.legacy-baseline.json`

**Interfaces:**
- Produces: baseline JSON ที่ Task 4 ต้องผ่านโดยไม่ regen. helper ในไฟล์เทสต์: `signedRequest(events: object[]): Request` (body JSON `{events}` + header `x-line-signature` = HMAC-SHA256 base64 ด้วย `LINE_CHANNEL_SECRET`).

- [ ] **Step 1: เขียนเทสต์ baseline** ตามแบบ `src/app/api/liff/orders/liff-orders.legacy.test.ts` (อ่านก่อน): `vi.stubEnv("DEPARTMENTS_ENABLED","")`; ตั้ง `process.env.LINE_CHANNEL_SECRET` ใน `vi.hoisted` **ก่อน** import route (route.ts:10 อ่านตอน import); `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` (route.ts:257 ใส่ `new Date().toISOString()` ใน argument) และ `vi.stubEnv("NEXT_PUBLIC_APP_URL", ...)` (route.ts:273). mock `@neondatabase/serverless` ให้ `neon()` คืน **shim ตัวเดียวร่วมกัน** (factory ทำงานครั้งเดียวต่อไฟล์เทสต์ ทั้ง `route.ts:9` และ `@/lib/db` จึงได้ instance เดียว) แล้ว spy `sql.db.query` ตอบตามข้อความ query (แบบ `answer()` ใน liff legacy test). mock `@/lib/line-bot` ทั้งโมดูล (reply*/lineClient/getLineOrderUrl บันทึก argument). ใช้ `bot-stock-queries` และ `getLineLinkedUser` ของจริง. บันทึกต่อเคส: statements `{text,params}` ตามลำดับ, จำนวน, status/body, argument ของ reply.
  เคส (ทุกเคสที่ตอบข้อมูลต้องรันครบสามแบบ **ไม่มี `source.userId` / userId ที่ไม่ผูกบัญชี / userId ของ Vendor**):
  - สต็อก: `stock <คำ>`, `stock งาน <คำ>`, `สต็อกเหลือ <คำ>`, `<คำ> เหลือเท่าไหร่`, `stock` เปล่า (มี / ไม่มีของต่ำกว่า min = สองสาขาที่ `:202-209`), `สต๊อก`
  - `PO-<เลข>` เจอแบบมี items / ไม่มี items / ไม่เจอ, และ `po-xxx` ตัวพิมพ์เล็ก; เลขพัสดุ `AB123456789TH` เจอ / ไม่เจอ
  - คำสั่งอื่น: `help`, `เมนู`, `order`, `เบิก`, `id` และ `ลงทะเบียน` (มี/ไม่มี userId), `สั่งซื้อ` (`:270`), ข้อความไม่ตรงคำสั่ง, `ปฏิเสธ PO-1: เหตุผล` (Vendor ผูก / ไม่ผูก)
  - postback: `ack_expiry` (ครบ / พารามิเตอร์ไม่ครบ), `acknowledge_po`, `confirm_vendor_po`, `start_vendor_reject` (Vendor มี/ไม่มี vendor), `confirm_po`/`reject_po`, action ที่ไม่รู้จัก (ยังยิง `SELECT username, role FROM users` ที่ `:305-307`)
  - event ไม่ใช่ข้อความ, event ไม่มี replyToken, หลาย event ใน batch เดียว, ลายเซ็นผิด → 401
  - **เคส 503** (ไม่มี secret และ `"DUMMY_SECRET"`) แยกใน `describe` ใหม่ที่ใช้ `vi.resetModules()` + `vi.stubEnv("LINE_CHANNEL_SECRET", ...)` + `await import("./route")` (เพราะ route.ts:10 อ่านค่าเป็นค่าคงที่ตอน import)
  เก็บผลเทียบ JSON; regen ได้เฉพาะ `UPDATE_LINE_WEBHOOK_BASELINE=1`. หัวไฟล์เขียนข้อจำกัด: ยืนยันผ่าน PGlite shim เท่านั้น ยังไม่เคยลองบน Neon.
- [ ] **Step 2:** สร้าง JSON บนโค้ดเดิม (`UPDATE_LINE_WEBHOOK_BASELINE=1 npx vitest run src/app/api/line-webhook/line-webhook.legacy.test.ts`) แล้วรันซ้ำสองครั้งโดยไม่ตั้ง env. Expected: PASS ทั้งสองครั้ง (พิสูจน์ว่าไม่สุ่มผล); `git status --porcelain` มีแค่ 2 ไฟล์ใหม่ (ห้ามมีไฟล์ใต้ `src/` อื่นเปลี่ยน).
- [ ] **Step 3: Commit** `Test: baseline line-webhook ตอนสวิตช์ปิด (กลุ่ม 6 PR-C)`.

### Task 2: ด่านตรวจ `getLineBotAccess`

**Files:**
- Modify: `src/lib/line-liff-ordering.ts` (เพิ่ม export), `src/lib/department-context.line-usage.test.ts`
- Test: `src/lib/line-bot-access.test.ts` (ใหม่, แบบ `src/lib/line-liff-ordering.test.ts`: mock `departments-flag`, `department-context`, `line-liff-auth`)

**Interfaces:**
- Produces (Task 3, 4 ใช้):
```ts
export type LineBotAccess =
  | { state: "legacy" }
  | { state: "unlinked" }
  | { state: "no_work" }
  | { state: "vendor"; vendor: string }
  | { state: "lab"; role: string; scope: { mode: "one"; departmentId: number } };
export async function getLineBotAccess(lineUserId: string | null): Promise<LineBotAccess>;
```
- Consumes: `departmentsReady`, `markDepartmentsNotReady`, `isMissingDepartmentSchemaError` (`departments-flag`), `getLineLinkedUserAccess` (`line-liff-auth`: `{state:"unlinked"|"inactive"|"active", user}`), `resolveDepartmentForLineUser(lineUserId, username)` (คืน user ที่มี `role` ที่มีผลจริง, `globalRole`, `scope: number` หรือ `null`).

- [ ] **Step 1: เขียนเทสต์ล้ม** (ชื่อ → ผลที่ assert):
  - `switch off returns legacy without any query` → `{state:"legacy"}`; mock `getLineLinkedUserAccess`/resolve ไม่ถูกเรียก
  - `null lineUserId with switch on is unlinked`; `unlinked` และ `inactive` → `{state:"unlinked"}`
  - `Vendor returns vendor state without resolving a department` → `{state:"vendor", vendor:"V"}` และ resolve ไม่ถูกเรียก; `Vendor with null vendor becomes empty string` → `vendor:""`
  - `lab user returns effective role and one-scope` → `{state:"lab", role:"Manager", scope:{mode:"one", departmentId:2}}`
  - `per-department override User is reported as User` → `role:"User"`
  - `resolve null is no_work`; `resolved globalRole Vendor is unlinked` (กันบัญชีเปลี่ยนเป็น Vendor ระหว่าง query, แบบ `line-liff-ordering.ts:46`)
  - `missing schema error falls back to legacy and marks not ready` (42P01); `other errors rethrow`
- [ ] **Step 2:** `npx vitest run src/lib/line-bot-access.test.ts` → FAIL.
- [ ] **Step 3: Implement** `getLineBotAccess` ใน `line-liff-ordering.ts` ตาม spec §5.1; ลำดับ: switch → ผูก → role Vendor → resolve → ตรวจ `globalRole`. `vendor: String(user.vendor ?? "")`. scope สร้างตรงเป็น `{mode:"one", departmentId: scoped.scope}` เมื่อ `typeof scoped.scope === "number"` มิฉะนั้น `no_work` (ไม่ต้อง import `scoped-db`). ห้ามใส่ role check ในด่าน.
- [ ] **Step 4: guard** ใน `department-context.line-usage.test.ts`: แก้ข้อความอธิบาย "exactly one caller" ให้ตรงความจริง (ไม่แก้ `ALLOWED`/`FORBIDDEN`) และเพิ่มเทสต์ `getLineBotAccess is only referenced by the gate file and the webhook` สแกน `src/` (ไม่ใช่ `.test.`) โดยใน Task นี้ **คาดหวังผลเท่ากับ `["src/lib/line-liff-ordering.ts"]` พอดี** (Task 4 จะเปลี่ยนเป็นสองไฟล์).
- [ ] **Step 5:** รันเทสต์ Task นี้ + `src/lib/line-liff-ordering.test.ts` (ของ PR-B ต้องยังผ่าน) → PASS; `tsc` ผ่าน.
- [ ] **Step 6: Commit** `Update: ด่านตรวจผู้ใช้ LINE สำหรับบอท (getLineBotAccess)`.

### Task 3: `line-bot-queries.ts` และตัวตัดสินคำสั่ง

**Files:**
- Create: `src/lib/line-bot-queries.ts`
- Test: `src/lib/line-bot-queries.test.ts` (pure + legacy text), `src/lib/line-bot-queries.dept.db.test.ts` (PGlite, แบบ `bot-stock-queries.dept.db.test.ts` + `seedTwoDepartments`, `addPurchaseOrderTables`, `insertPurchaseOrder`)

**Interfaces:**
- Consumes: `LineBotAccess` (Task 2, import type เท่านั้น), `andDept`, `DepartmentScope` (`scoped-db`), `sql` (`@/lib/db`), `isLabPurchasingRole` (`purchase-order-workflow`).
- Produces (Task 4 ใช้):
```ts
export type LineBotActor =
  | { kind: "legacy" }
  | { kind: "lab"; scope: { mode: "one"; departmentId: number } }
  | { kind: "vendor"; vendor: string };
export type LineBotDecision =
  | { ok: false; message: string }
  | { ok: true; command: "stock"; scope: DepartmentScope }
  | { ok: true; command: "purchasing"; actor: LineBotActor };
export const LINE_BOT_MESSAGES: { unlinked: string; noWork: string; purchasingDenied: string; vendorStockDenied: string };
export function decideLineBotCommand(access: LineBotAccess, command: "stock" | "purchasing"): LineBotDecision;
export async function findPurchaseOrderForLine(poNumber: string, actor: LineBotActor): Promise<Record<string, unknown> | null>;
export async function findShipmentForLine(trackingNo: string, actor: LineBotActor): Promise<Record<string, unknown> | null>;
```
(ฟังก์ชันค้นคืน **แถวเดียวหรือ null**; items ของ PO ยังดึงใน route ด้วยคำค้นเดิม.)

- [ ] **Step 1: เขียนเทสต์ล้ม**
  - pure `decideLineBotCommand`: legacy → stock `{ok:true, command:"stock", scope:{mode:"legacy"}}` และ purchasing `{ok:true, command:"purchasing", actor:{kind:"legacy"}}`; unlinked→`message === LINE_BOT_MESSAGES.unlinked`; no_work→`noWork`; vendor+stock→`vendorStockDenied`; vendor+purchasing→`actor:{kind:"vendor", vendor}`; lab Manager/Admin+purchasing→`actor:{kind:"lab", scope}`; lab `User`/`Operator`/`Technician`+purchasing→`purchasingDenied`; lab ทุก role+stock→`scope` ของ lab
  - legacy text: spy SQL แล้ว assert ข้อความ/พารามิเตอร์ของ `findPurchaseOrderForLine`/`findShipmentForLine` กับ `{kind:"legacy"}` **เท่ากับ `route.ts:216` และ `:249` ตัวอักษรต่อตัวอักษร** (สองคำค้นนี้อยู่บรรทัดเดียว)
  - `assertActor`: undefined / string / `kind` แปลก / `lab` ที่ `scope.mode` เป็น `legacy` หรือ `all` หรือ `departmentId` ไม่ใช่จำนวนเต็มบวก / `vendor` ที่ไม่ใช่ string → **throw ทั้งสองฟังก์ชัน**
  - dept.db: control query ว่ามี PO/shipment ของแผนก A, B และ vendor V1, V2 อยู่จริง + แถวเหยื่อล่อ `vendor = ''`; positive control (lab A เห็น PO-A; vendor V1 เห็น PO ของ V1); lab A ไม่เห็นของ B (null); vendor V1 เห็น PO/พัสดุของ V1 **ทั้งสองแผนก** และไม่เห็นของ V2; vendor `""` / `"  "` → null **และไม่ยิง SQL** (spy ไม่เห็น statement) และไม่จับคู่แถว `vendor = ''`; **vendor V1 พิมพ์ PO ของตัวเองสถานะ `PENDING_MANAGER_REVIEW` → null** (พัสดุไม่มีเงื่อนไขสถานะ)
- [ ] **Step 2:** รัน → FAIL.
- [ ] **Step 3: Implement** ตามลายเซ็น: legacy → ข้อความเดิม; lab → `SELECT * FROM purchase_orders WHERE po_number = ${n}${andDept(scope)}`; vendor → `SELECT * FROM purchase_orders WHERE po_number = ${n} AND vendor = ${vendor} AND status <> 'PENDING_MANAGER_REVIEW'` (ไม่กรองแผนก); พัสดุ vendor → `... WHERE tracking_no = ${n} AND vendor = ${vendor}`. ตรวจ vendor ว่างด้วย `.trim()` แต่ query ด้วยค่าเดิม (เหมือน `vendor/shipments/route.ts:57`). ข้อความไทยตาม spec §5.4.
- [ ] **Step 4:** รัน → PASS; coverage test ผ่าน (ไฟล์ใหม่ import `scoped-db`).
- [ ] **Step 5: Commit** `Update: line-bot-queries (PO/พัสดุตาม actor) และ decideLineBotCommand`.

### Task 4: เดินสาย webhook, ถอด PENDING, เทสต์สวิตช์เปิด

**Files:**
- Modify: `src/app/api/line-webhook/route.ts` (ข้อความ `:186-246`; ตัด SQL `:216` และ `:249` เท่านั้น), `src/lib/department-scope-coverage.test.ts` (ถอด `"src/app/api/line-webhook/route.ts"` → เหลือ 2), `src/lib/department-context.line-usage.test.ts` (คาดหวังผลเป็น `["src/app/api/line-webhook/route.ts", "src/lib/line-liff-ordering.ts"]` พอดี)
- Test: `src/app/api/line-webhook/line-webhook.dept.db.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `getLineBotAccess` (Task 2), `decideLineBotCommand`, `findPurchaseOrderForLine`, `findShipmentForLine` (Task 3), `searchStockRows(keyword, 10, scope)`, `searchStockRowsByJob(keyword, scope)`, `getLowStockRows(10, scope)`.

- [ ] **Step 1: เขียนเทสต์ล้ม** `line-webhook.dept.db.test.ts` (`vi.stubEnv("DEPARTMENTS_ENABLED","true")`; PGlite + `seedTwoDepartments` + `addPurchaseOrderTables`; shim เดียว + mock `@/lib/line-bot`; ลายเซ็นจริง; ใช้ DATE parser แบบ Neon เหมือน `liff-orders.dept.db.test.ts` เพราะ `expected_date` ส่งเข้า `replyPODetail`). ผู้ใช้ทุกคนต้องตั้ง `users.line_user_id` เอง: mgra (Manager,A), mgrb (Manager,B), user-a (User,A), mgr-user-override (global Manager สร้างใหม่ + `user_departments.role='User'`), mgr-operator-override (`Operator`), mgr-technician-override (`Technician`), mgrnone (ไม่มี membership), mgr-inactive-dept (แผนก default ถูกปิด), admin-nomember (Admin ไม่มี membership → แผนก active id ต่ำสุด), vendor-v1/vendor-v2/vendor-blank, vendor-nomember (ไม่มีแถว `user_departments`), inactive-account, unlinked-id. เคส (assert ผ่าน reply argument และ **spy ว่าไม่ถึง query ข้อมูลในเคสปฏิเสธ**):
  - unlinked / inactive / ไม่มี `source.userId` พิมพ์ `PO-…`, เลขพัสดุ, `stock` → `unlinked` และไม่มี statement จาก `purchase_orders`/`shipments`/`inventory`
  - mgrb ไม่เห็น PO/พัสดุ/สต็อกของ A; mgra เห็น (positive control); admin-nomember ได้แผนกต่ำสุดทั้งสต็อกและ PO
  - mgrnone และ mgr-inactive-dept → `noWork`
  - user-a, mgr-user-override, operator, technician พิมพ์ `PO-…`/พัสดุ → `purchasingDenied`; พิมพ์ `stock` → ได้ผลแผนกตัวเอง
  - vendor-v1 เห็น PO/พัสดุของ V1 ทั้งสองแผนก ไม่เห็นของ V2 ("ไม่พบ…"); PO ของ V1 สถานะ `PENDING_MANAGER_REVIEW` → "ไม่พบ…"; `stock` → `vendorStockDenied`; vendor-blank → ไม่พบ (และไม่เห็นแถว `vendor=''`); vendor-nomember ยังเห็น PO ของบริษัทตัวเอง (หลักฐานของ spec §5.5 ข้อ 2)
  - `id` / `ลงทะเบียน` / `help` / `เมนู` / `order` / `เบิก` / `สั่งซื้อ` ตอบปกติทุกกรณีรวม unlinked; postback `ack_expiry` และ SQL postback ทำงานเหมือนเดิมแม้ unlinked
  - error ของด่าน (DB ล้มทั่วไป) → response 500 ไม่กลืน; 42P01 → ตอบแบบ legacy
- [ ] **Step 2:** รันเทสต์ใหม่ + baseline Task 1 → dept test FAIL, baseline PASS.
- [ ] **Step 3: แก้ route** ตาม spec §5.3: ในสาขา stock และ `PO-`/พัสดุ เรียก `getLineBotAccess(event.source?.userId ?? null)` → `decideLineBotCommand(access, "stock"|"purchasing")` → `ok:false` ตอบ `message` ด้วย `sendReply` แล้ว `return`; `ok:true` ส่ง `scope`/`actor` เข้าฟังก์ชัน (แทน `{mode:"legacy"}` ทั้ง 3 จุด และคอมเมนต์ `// legacy until PR-C`). แทนเฉพาะ `SELECT * FROM purchase_orders …` (`:216`) และ `SELECT * FROM shipments …` (`:249`) ด้วย `findPurchaseOrderForLine`/`findShipmentForLine`; **คงคำค้น items (`:220-224`) ตรรกะประกอบ `PurchaseOrder`/`TrackingResult` และข้อความ "ไม่พบ…" เดิม**. ไม่แตะสาขาอื่น/postback/ลายเซ็น/`Promise.all`.
- [ ] **Step 4: ถอด PENDING** ใน `department-scope-coverage.test.ts` (3→2) และปรับ guard ตามหัวข้อ Files. รันเทสต์ของ Task นี้ + coverage + line-usage + baseline → PASS (ถ้า coverage แจ้งว่า webhook ยังแตะตารางแผนก ให้หยุดรายงาน อย่าเดา).
- [ ] **Step 5: mutation** (แก้ชั่วคราวใน working tree แล้วคืน, รายงานผลทุกข้อ): ลบ `andDept` ใน `findPurchaseOrderForLine`; ลบ filter vendor; ลบเงื่อนไข `status <> 'PENDING_MANAGER_REVIEW'`; ข้ามด่าน (ส่ง `{kind:"legacy"}` ตายตัว); กลืน error ของด่าน; ลบการตรวจ `isLabPurchasingRole` ใน `decideLineBotCommand`; คืน `legacy` เมื่อ `userId` ว่าง; ย้อน `{mode:"legacy"}` ของสต็อก; ผ่อน `assertActor` ให้รับ `lab` mode อื่น. ทุกข้อต้องมีเทสต์ล้ม ข้อที่พิสูจน์ไม่ได้ให้บอกตรง ๆ. ตรวจ `git status --porcelain` ว่าไม่มีไฟล์ค้าง.
- [ ] **Step 6:** `npx vitest run` ทั้งชุด, `npx tsc --noEmit -p .`, `npm run lint` → ผ่าน (0 error). `npm run build` หัวหน้าทีมรันเอง.
- [ ] **Step 7: Commit** `Update: line-webhook กรองตามแผนก/vendor (กลุ่ม 6 PR-C, PENDING 3 -> 2)`.

### Task 5: เอกสาร

**Files:**
- Modify: `docs/departments-rollout.md`, หัวของ `docs/superpowers/specs/2026-10-26-line-webhook-department-scope-design.md` (สถานะ → "อนุมัติโดยเจ้าของ 26 ต.ค.; ทำเสร็จใน PR-C")

- [ ] **Step 1:** เพิ่ม `### PR-C` ใต้หัวข้อ 13 (ตารางใครเห็นอะไรจาก spec §2, PENDING 3→2 ที่เหลือ `auth/register`, `mobile/lookup` ตั้งใจ); แก้ประโยคล้าสมัยที่ยังบอกว่า "รอ PR-C" (ค้นด้วย `rg -n "PR-C" docs/departments-rollout.md`) แต่ **คง "ห้ามเปิด `DEPARTMENTS_ENABLED`"** จนกว่าตรวจ Neon + v36 + แถวหัวกระดาษ + v30–v34. จดข้อจำกัด: Vendor ที่ไม่มีแถวแผนกดู PO/พัสดุของบริษัทตัวเองใน LINE ได้ (หลวมกว่าเว็บ), Vendor ไม่เห็น PO สถานะรอผู้จัดการตรวจ (ตรงกับเว็บ), role `User`/`Operator`/`Technician` ถูกปฏิเสธ PO/พัสดุ, Vendor ดูสต็อกไม่ได้, redelivery เมื่อ DB ล้ม, ยืนยันผ่าน PGlite เท่านั้น.
- [ ] **Step 2: Commit** `Update: เอกสาร rollout กลุ่ม 6 PR-C (line-webhook)`.

## Self-review (ผู้เขียนแผน)
- Spec coverage: §2 เป้าหมาย→Task 2-4; §5.1→T2; §5.2→T3; §5.3→T4; §5.4/5.5→T3 (ข้อความ), T2 (guard, ไม่มี role ในด่าน), T3 (vendor ว่าง/สถานะ PENDING_MANAGER_REVIEW); §6 ทดสอบ→T1/T3/T4; §7 ความเสี่ยง→T5.
- ชื่อสอดคล้อง: `LineBotAccess`, `LineBotActor`, `LineBotDecision` (union ตาม `command`), `decideLineBotCommand`, `findPurchaseOrderForLine`, `findShipmentForLine`, `LINE_BOT_MESSAGES` ตรงกันทุก Task.
- ลำดับ commit ทำให้ coverage และ guard test ผ่านทุกขั้น: webhook อยู่ใน PENDING จนถึง Task 4; guard คาดหวังชุดไฟล์ให้ตรงความจริงในแต่ละ commit.
