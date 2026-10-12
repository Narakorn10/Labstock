# แผน v1 (จาก planner): ย้ายเบิก/รับเข้าเข้า scoped-db — ตัวย่อที่ผู้นำเขียน ตรวจ path:line กับโค้ดจริงเอง

เป้าหมาย: เบิก/รับเข้า (เว็บ, มือถือ, LIFF) ทำได้เฉพาะของในห้องที่เลือก; โหมด ALL (Admin) บันทึกไม่ได้; flag DEPARTMENTS_ENABLED ปิด = พฤติกรรมเดิมเป๊ะ; ไม่ต้อง migration/env ใหม่.

## ข้ออ้างของ planner (ผู้ตรวจต้องพิสูจน์เอง)
- scoped-db.ts: getDepartmentScope (legacy/one/all) :53-65; deptWhere/andDept :74-85; deptWhereWrite/andDeptWrite (all → DEPARTMENT_READ_ONLY) :88-97; writeDepartmentId/deptInsert :100-115; departmentErrorResponse :122-128; legacy ⇒ ชิ้น SQL ว่าง/TRUE. ยังไม่มี src ไฟล์ไหน import scoped-db จริง.
- departmentsReady() ปิด ⇒ false ไม่เรียก DB (departments-flag.ts:121-123).
- DEPARTMENT_SCOPE_PENDING อยู่ใน src/lib/department-scope-coverage.test.ts:30-82 (51 รายการ; stock-transactions.ts บรรทัด 80). route dispense/receive/mobile-confirm ไม่อยู่ในรายการ (ไม่มี SQL เอง) ⇒ แผนนี้ลดแค่ 51→50.
- SQL ใน src/lib/stock-transactions.ts: low-stock check :31-51; notification_settings JOIN users :59-64 (ไม่กรองห้อง); receive: master_data :79, labstock_assert FOR UPDATE :110-116, INSERT inventory ON CONFLICT(item_id,lot_no,received_on) + logs :117-130; dispense: master_data :167, หาแถวสต็อก :194-204, ในธุรกรรม assert :237-243, ล็อก inventory :245-253, UPDATE inventory + logs :254-266; notify :143-152, :280-289.
- ผู้เรียก: dispense/route.ts:26, receive/route.ts:26 (user จาก hasMenuPermission มีห้องแล้ว); mobile/confirm/route.ts:75-77 user จาก verifyUserPin (auth-utils.ts:236-275) / getLineLinkedUser (line-liff-auth.ts:67-103) **ไม่มีห้อง**.
- ที่เขียน inventory แต่ grep ไม่เจอ: DB function process_station_withdrawal (upgrade_v8_reagent_scanner.sql:80,152-186, เรียกจาก src/lib/station-withdrawals.ts:122-136); trigger trg_inventory_require_active_master_data (v24:55-88).
- classify ใน api-response.ts:66-91 ไม่รู้จัก DepartmentScopeError ⇒ 500.
- UNIQUE(item_id,lot_no,received_on) ไม่รวมห้อง (pglite-prod-schema.ts:85); master_data.item_id PK ทั้งระบบ.
- เทสต์เดิม stock-transactions.db.test.ts:44-84 (เบิกหลายรอบ 6 เคส) ใช้ schema ที่ไม่มี department_id; route tests dispense/receive :50 ตรวจ toHaveBeenCalledWith(any Array, user, any Object) จะล้มถ้าเพิ่ม arg 4.

## ขั้นตอน
0. แตก branch ใหม่ซ้อน feat/departments-auth (ชื่อรอผู้ใช้ยืนยัน), รัน vitest/tsc/lint เก็บ baseline.
1. เทสต์ characterization ของ runReceiveBatch บน schema เดิม (lot เดิมวันเดียวกัน 2 ครั้ง=แถวเดียวบวกรวม, lot ใหม่, exp ว่างไม่ทับ, รายการปิดใช้งาน REAGENT_INACTIVE ไม่เขียนอะไร, qty<=0 กรองทิ้ง, 1 log/การรับ). ต้องผ่านบนโค้ดปัจจุบัน.
2. เทสต์ใหม่ stock-transactions.dept.db.test.ts (2 ห้อง; ต้องสร้าง labstock_assert + mock notifications) แล้วแก้:
   2b stock-transactions.ts: runReceiveBatch/runDispenseBatch รับ arg ที่ 4 บังคับ `scope: DepartmentScope`; บรรทัดแรกเรียก writeDepartmentId(scope) (all ⇒ throw ก่อนมี SQL); master_data :79,:167 เติม andDept; โหมด one ถ้ารายการไม่อยู่ห้อง ⇒ error code ใหม่ (รอผู้ใช้); เบิก: :194-204 เติม andDept (ทั้ง query หลัก + subquery preferredId), :238-243 / :246-253 / :256-261 เติม andDeptWrite (เงื่อนไขเดียวกันทั้งตรวจและ UPDATE), logs ใช้ deptInsert; รับเข้า: :111-115 andDeptWrite, inventory insert + logs ใช้ deptInsert, โหมด one เพิ่ม assert NOT EXISTS แถว inventory item/lot/CURRENT_DATE ที่ department_id<>scope (กัน ON CONFLICT ชนข้ามห้อง); low-stock check :31-51 รับ scope เติม andDept ที่ master_data (ผู้รับแจ้งเตือนยังไม่แก้).
   2c routes: dispense/receive เรียก getDepartmentScope(user) แล้วส่งต่อ; catch ใช้ `departmentErrorResponse(error, ctx.requestId) ?? ctx.fail(error)`; mobile/confirm ส่ง getDepartmentScope(user) + แปลง error ก่อน catch เดิม (flag เปิดก่อนทำขั้น 3 ⇒ 500 ปฏิเสธไว้ก่อน).
   2d ลบ stock-transactions.ts ออกจาก PENDING (:80), เพิ่ม error code ใน errors.ts (+เทสต์), แก้ route tests :50 เป็น `..., {mode:"legacy"}` + เคส all→409, denied→404.
   commit: "Update: scope dispense/receive stock transactions by department (flag off = unchanged)"
3. (เสี่ยงสูง แตะ auth) department-context.ts เพิ่มวิธีค้นที่ 3 `verifiedUsername` (ใช้ได้หลังตรวจ PIN/LINE ผ่านเท่านั้น); mobile/confirm: ถ้า departmentsReady() ⇒ resolveUserDepartment({verifiedUsername, requested:null, explicit:false}); null ⇒ 403; 42P01/42703 ⇒ fallback เดิม; ตรวจ Vendor/roleHasMenu ด้วยสิทธิ์ของห้องนั้น; ห้อง = default ของผู้อนุมัติ (ถามผู้ใช้). เทสต์ครบทั้งสวิตช์ปิด/เปิด.
4. เอกสาร: docs/departments-rollout.md, decisions.md (ไม่ commit ψ/).

## เกณฑ์ยอมรับ
flag ปิด: เทสต์เดิม 6 เคส + characterization ผ่านโดยไม่แก้บน schema ไม่มีคอลัมน์ห้อง; getDepartmentScope ไม่เรียก SQL; one: ข้ามห้องถูกปฏิเสธ inventory/logs ไม่เปลี่ยน แถวใหม่/logs มี department_id=ห้องที่เลือก; all: 409 ไม่เรียก SQL; denied: 404; PENDING=50; vitest/tsc/lint/build ผ่าน; JSON สำเร็จเหมือนเดิม.

## แผนเทสต์
route units; DB 2 ห้อง (ข้ามห้อง, inventoryId ข้ามห้อง, lot ซ้ำหลายรอบ/2 ห้อง, ข้อมูลไม่ตรงกัน inventory.department_id≠master, รับเข้าชนแถวห้องอื่น); race จำลองด้วย wrap sql.transaction; race จริงตรวจไม่ได้ใน PGlite (พึ่ง FOR UPDATE + quantity>=qty เดิม); ซ้อมจริงบน Neon branch ต้องขออนุมัติ.

## ความเสี่ยง/ rollout / ย้อนกลับ
ไม่ต้อง migration/env; deploy ปิดสวิตช์ก่อน; ย้อนกลับ = ปิดสวิตช์ หรือ git revert ทีละ commit. ตัวเขียน inventory อื่นยังไม่ย้าย (count-work-orders.ts:220-224, vendor/shipments/[id]/route.ts:78-84, reagent-loans/route.ts:90-126, inventory/reconcile/route.ts:58-67, process_station_withdrawal) ⇒ เขียนห้อง CC default; /api/mobile/lookup ไม่ล็อกอิน คืนทุกห้อง.

## คำถามที่รอผู้ใช้
1 มือถือ/LIFF ใช้ห้อง default ของผู้อนุมัติไปก่อน หรือรอปุ่มเลือกห้อง; 2 error code ใหม่ ITEM_NOT_IN_DEPARTMENT vs LOT_NOT_AVAILABLE; 3 แจ้งเตือนแยกห้องตอนนี้หรือทีหลัง; 4 process_station_withdrawal ใช้ใน production ไหม; 5 v35 ตัวกันใน DB (trigger/FK ผสม) ไหม; 6 ชื่อ/การซ้อน branch; 7 อนุญาตซ้อมบน Neon branch ไหม.

---

# ผลตรวจแผน (plan-reviewer, Opus, วิธี scrutinize) — 2026-10-10
คำตัดสิน: **ผ่านแบบมีเงื่อนไข (fix-then-ship)**. สุ่มตรวจ path:line 15 จุด ตรงโค้ดจริงทั้งหมด; Neon driver 1.1.0 ต่อชิ้น SQL ซ้อนได้จริง (index.mjs:1237-1239).
ทางเลือกที่ง่ายกว่าที่ตรวจแล้ว: guard แค่ชั้น route ใช้ไม่ได้กับรับเข้า (DEFAULT ห้อง CC, v31:4-7,31,40) → ต้องแก้ใน stock-transactions.ts; แนะนำ **แยกขั้น 3 (auth PIN/LINE) เป็น PR ต่างหาก** ต้อง merge ก่อนเปิดสวิตช์; เก็บ assert ข้ามห้องตอนรับเข้า (ยังไม่มี constraint ใน DB, v32:48-78).

## ต้องแก้ก่อนเริ่ม
1. arg ที่ 4 บังคับ ขัดกับ "เทสต์เดิมผ่านโดยไม่แก้" (stock-transactions.db.test.ts:46-83 เรียก 3 arg; scoped-db.ts:100-103 อ่าน scope.mode → TypeError, tsc ล้ม) → เก็บ arg บังคับ แก้เกณฑ์เป็น "เทสต์เดิมแก้แค่เติม {mode:"legacy"} ห้ามแก้ expect".
2. error ใหม่จาก labstock_assert → classify() (api-response.ts:80-91) ไม่รู้จัก ⇒ 500/ข้อความดิบ (mobile/confirm/route.ts:87-91) → เพิ่ม classify + เทสต์; ตรวจ "รายการไม่อยู่ห้อง" ใน JS ก่อนธุรกรรมเฉพาะโหมด one (ไม่งั้นได้ข้อความผิด REAGENT_INACTIVE); legacy ห้ามมี.
3. ขั้น 3: ต้องส่ง `user.username` ที่ได้จาก verifyUserPin/getLineLinkedUser (auth-utils.ts:244-247 ใช้ LOWER) ไม่ใช่ body.username; resolveUserDepartment เทียบตรงตัว (department-context.ts:93) ⇒ เพิ่มเทสต์ตัวพิมพ์ต่าง.
4. ขั้น 3: **อย่าเพิ่ม verifiedUsername ใน ResolveDepartmentQuery ที่ใช้ร่วม** (ช่องโหว่อนาคต; ผู้ใช้ PIN อื่น: mobile/line-link/route.ts:23, stations/authorize-user/route.ts:25) → ทำฟังก์ชันแยก resolveDepartmentForVerifiedUser(user) + เทสต์ว่ามีแค่ mobile/confirm import; Vendor ตรวจด้วย globalRole, roleHasMenu ด้วย role ประจำห้อง.
## ควรแก้
5. assert ข้ามห้องต้องตรง ON CONFLICT เป๊ะ: WHERE item_id=… AND lot_no=… AND received_on=CURRENT_DATE AND department_id<>id (ไม่ใช้ LOWER) ใน sql.transaction เดียวกันก่อน INSERT; บันทึก race ที่เหลือ (INSERT แทรก) เป็นความเสี่ยงต่ำ.
6. inventory.department_id ≠ master จะ "หายจากการเบิก" เงียบ (LOT_NOT_AVAILABLE) → เทสต์กำหนดผลชัด + query ตรวจความสอดคล้อง (inventory JOIN master_data ห้องต่าง = 0) ใน rollout doc ก่อนสร้างห้องที่สอง.
7. ไม่มีอะไรกันลืมขั้น 3 ก่อนเปิดสวิตช์ (mobile/confirm ไม่อยู่ใน PENDING) → ใส่เงื่อนไขใน docs/departments-rollout.md ข้อ 6/8 หรือเพิ่มเข้า pending แยก (ระหว่างนี้ 500 = fail-closed ยอมรับได้).
8. DB test ใหม่: mock @/lib/db ด้วย createPgliteSql() ตัวเดียวทั้ง stock-transactions+scoped-db (แบบ stock-transactions.db.test.ts:4-7) หรือเติม delegate.transaction; สร้าง labstock_assert หลัง applyProdSchema (มีแค่ใน pglite-sql.ts:88-93); mock notifications; notification_settings: ปล่อย error ให้ catch (stock-transactions.ts:69-71) หรือสร้างตารางเปล่า — ระบุเลือกแบบไหน.
9. เพิ่มเทสต์ mobile/confirm/route.test.ts (mock runReceive/DispenseBatch :11-12,27-28): flag ปิด ส่ง {mode:"legacy"} + JSON approver เดิม; DEPARTMENT_SCOPE_MISSING ต้องไม่คืนข้อความดิบที่มี username (route.ts:89-91).
## ข้อเสนอเพิ่ม
10. แยก commit ขั้น 2: (a) characterization (b) dispense (c) receive (d) classify+errors.
11. ใส่ process_station_withdrawal (station-withdrawals.ts:122-136; v8:177,186) และ stations/sync-withdrawal/route.ts เป็นงานค้างใน rollout doc.
12. ถ้าไม่แก้ classify() ให้ใช้ helper ตัวเดียว departmentErrorResponse(e, ctx.requestId) ?? ctx.fail(e) (trackRoute ยังบันทึกได้ app-events.ts:155-180); ถ้าแก้ classify ใช้ err.name==="DepartmentScopeError" กัน import วน (scoped-db.ts:4).

## คำถามถึงผู้ใช้ (7 ข้อจากแผน + 2 ข้อจากผู้ตรวจ)
แผน: 1 มือถือ/LIFF ใช้ห้อง default ของผู้อนุมัติไปก่อน vs รอปุ่มเลือกห้อง; 2 error code ใหม่ ITEM_NOT_IN_DEPARTMENT vs LOT_NOT_AVAILABLE; 3 แจ้งเตือนแยกห้องตอนนี้/ทีหลัง; 4 process_station_withdrawal ใช้ใน production ไหม; 5 v35 ตัวกันใน DB ไหม; 6 ชื่อ/การซ้อน branch; 7 อนุญาตซ้อมบน Neon branch ไหม.
ผู้ตรวจเพิ่ม: 8 มีแผน "ย้ายรายการข้ามห้อง" ในอนาคตไหม (ต้องย้าย inventory/logs ตาม); 9 แจ้งเตือน STOCK_RECEIVED/DISPENSED ส่งรวม (stock-transactions.ts:144-151,281-288) — ห้อง CC เห็นความเคลื่อนไหวห้อง B ยอมรับได้จนกว่าแยกแจ้งเตือนไหม.
