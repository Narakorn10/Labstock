# แผน v3 (รอบแก้สุดท้าย, planner Opus) — ใช้คู่กับ v2 (ส่วนที่ไม่ระบุ = "เหมือน v2")
ยึด ψ/plans/2026-10-10_stock-scope-plan-v2.md; ผู้ตรวจรอบ 2 = ผ่านแบบมีเงื่อนไข; v3 แก้ครบ 9 ข้อ; ไม่มีคำถามค้างถึงผู้ใช้
คำตัดสินเพิ่ม: Q-V Vendor ได้ LOW_STOCK ทุกงาน (เฉพาะสินค้าตัวเอง ผ่าน vendor-notification-scope เดิม) ไม่ต้องมีแถว user_departments; Q-W ข้อความผู้ใช้ใช้คำว่า "งาน" (ห้ามมี "ห้อง"/"ที่คุณเลือก"); Admin ไม่มีแถวงาน B ไม่ได้แจ้งเตือนงาน B; ITEM_NOT_IN_DEPARTMENT=409; STOCK_RECEIVED/DISPENSED คงไม่ส่งถึงใคร+เทสต์กัน; process_station_withdrawal/stations/* นอกขอบเขต

## ตอบผลตรวจรอบ 2
1 isDepartmentScopeFailure(err) (api-response.ts) = true เมื่อ (ก) err.name==="DepartmentScopeError" (ข) err instanceof AppError && code==="ITEM_NOT_IN_DEPARTMENT" (ค) rawMessage(err).startsWith("ITEM_NOT_IN_DEPARTMENT") (rawMessage :36-43; ครอบ error จาก labstock_assert); เทสต์ทั้ง AppError และ new Error("ITEM_NOT_IN_DEPARTMENT: X")→409 ไทย; REAGENT_INACTIVE/Error อื่นผลเดิม
2 ใช้ "งาน": message "รายการนี้ไม่อยู่ในงานของคุณ" (+ " (${itemId})" เมื่อโยนจาก JS); hint "ตรวจสอบรหัสรายการ หรือสลับไปงานที่เป็นเจ้าของรายการนี้"; ตรวจ `rg -n "ห้องที่คุณเลือก|ที่คุณเลือก" src` ต้องไม่เจอ
3 ผู้รับ LOW_STOCK โหมด one (alias จริง n/u ที่ stock-transactions.ts:59-64): ดูขั้น 5
4 ตำแหน่งชิ้น SQL: ดูขั้น 3, 4
5 เคส 3 เขียนใหม่ (ดูขั้น 3)
6 8b ใช้ isMissingDepartmentSchemaError (departments-flag.ts:45-48); error อื่น → return ctx.fail(e) ห้ามไหลไป catch เดิม (route.ts:87-92)
7 8a ฟังก์ชันภายในรับ checkTokenExpiry: boolean (ทาง token = q.token !== undefined เหมือน department-context.ts:122; session/verified = false)
8 mapping ตัวเดียว: export departmentScopeErrorResponse(err, requestId): NextResponse|null จาก api-response.ts ให้ทั้ง classify() และ departmentErrorResponse (scoped-db.ts:122-128) เรียก (scoped-db import api-response อยู่แล้ว :4 ไม่วน)
9 rollout doc + PR notes: (ก) Admin ที่สร้างหลังรัน v30 ครั้งสุดท้ายไม่ได้ LOW_STOCK ถ้าไม่มีแถวสมาชิก (ยังล็อกอินได้ department-context.ts:110) (ข) /api/mobile/lookup ยังคืนทุกงาน (PENDING coverage.test.ts:42) → ITEM_NOT_IN_DEPARTMENT fail-closed ยอมรับได้ (ค) commit c-e ต้อง merge พร้อมกันใน PR เดียว ห้าม deploy ครึ่งทาง; revert ให้ revert c-e ทั้งชุด

## ขั้น 0 เหมือน v2 (branch feat/departments-stock-scope จาก feat/departments-auth; baseline vitest/tsc/lint/build; ห้าม npm run dev ทำรายการจริง .env.local ชี้ production)

## ขั้น 1 (commit a) characterization: เหมือน v2 + mobile/confirm/route.test.ts 3 เคสคงผลเดิม (route.ts:87-92): AppError REAGENT_INACTIVE→409 {error:"REAGENT_INACTIVE: R1"}; new Error("boom")→400 {error:"boom"}; AppError REAGENT_STOCK_INSUFFICIENT→400 ข้อความดิบ

## ขั้น 2 (commit b) errors+classify
errors.ts (catalogue :12-43) เพิ่ม ITEM_NOT_IN_DEPARTMENT: {status:409, message:"รายการนี้ไม่อยู่ในงานของคุณ", hint:"ตรวจสอบรหัสรายการ หรือสลับไปงานที่เป็นเจ้าของรายการนี้"} (ผ่าน errors.test.ts:7-14)
api-response.ts (ไม่ import scoped-db): export departmentScopeErrorResponse(err, requestId) — null ถ้า err.name!=="DepartmentScopeError"; อ่าน code แบบ duck-type: DEPARTMENT_NOT_FOUND→apiError("DEPARTMENT_NOT_FOUND") 404; DEPARTMENT_READ_ONLY→409; อื่น (DEPARTMENT_SCOPE_MISSING)→apiError("INTERNAL_ERROR") 500 ไม่ใส่ข้อความดิบ. export isDepartmentScopeFailure ตามข้อ 1. classify() (:66-92): หลังกิ่ง AppError (:67-69) เพิ่ม `const dept = departmentScopeErrorResponse(err, requestId); if (dept) return dept;`; ถัดจากกิ่ง REAGENT_* (:80-87) เพิ่ม message.startsWith("ITEM_NOT_IN_DEPARTMENT")→apiError("ITEM_NOT_IN_DEPARTMENT",{requestId, ...(itemId?{message:`รายการนี้ไม่อยู่ในงานของคุณ (${itemId})`}:{})}) ใช้ legacyItemId (:61-64). AppError ITEM_NOT_IN_DEPARTMENT ไม่ต้องกิ่งใหม่
scoped-db.ts departmentErrorResponse (:122-128): คง signature, instanceof DepartmentScopeError (:123), console.error SCOPE_MISSING (:126); map เรียก departmentScopeErrorResponse; scoped-db.db.test.ts:217-251 ผ่านโดยไม่แก้
เทสต์ api-response.test.ts: 3 code; SCOPE_MISSING message มี username→body ไม่มี; isDepartmentScopeFailure ครบ 3 เงื่อนไข + false สำหรับ REAGENT_INACTIVE/new Error("boom")/string; toApiError(AppError ITEM_NOT_IN_DEPARTMENT)→409 ไทย; toApiError(new Error("ITEM_NOT_IN_DEPARTMENT: X"))→409 "รายการนี้ไม่อยู่ในงานของคุณ (X)"; error เดิมผลเดิม; departmentErrorResponse กับ toApiError ให้ status+code เดียวกันทั้ง 3 code

## ขั้น 3 (commit c) เบิก — runDispenseBatch (stock-transactions.ts)
- บรรทัดแรก writeDepartmentId(scope); arg ที่ 4 scope: DepartmentScope บังคับ
- :167 SELECT item_id, name, is_active FROM master_data WHERE ${deptWhere(scope)}
- ในลูป หลัง :187 ก่อน :188: โหมด one และ activeMap ไม่มีคีย์ → new AppError("ITEM_NOT_IN_DEPARTMENT",{message:`รายการนี้ไม่อยู่ในงานของคุณ (${targetItemId})`, detail:`ITEM_NOT_IN_DEPARTMENT: ${targetItemId}`}) (legacy ห้ามมีโค้ดใหม่ทำงาน)
- :194-204 query หลัก ${andDept(scope)} ต่อท้าย AND quantity > 0 (:198); subquery :200 ต่อท้าย AND LOWER(item_id)=LOWER(${targetItemId}) ก่อนวงเล็บปิด
- master assert :238-242 ${andDeptWrite(scope)} หลัง AND is_active = TRUE (:240) ก่อน FOR UPDATE (:241)
- inventory assert :246-252 andDeptWrite หลัง AND quantity >= ${allocation.qty} (:250) ก่อน FOR UPDATE (:251)
- UPDATE :256-260 andDeptWrite ต่อท้าย AND quantity >= ${allocation.qty} (:260) ก่อน RETURNING (:261)
- logs :263-264 `const d = deptInsert(scope)` นอกธุรกรรม: `..., ip_address${d.column})` และ `${audit.ipAddress}${d.value}`
- ลบ "src/lib/stock-transactions.ts" ออกจาก PENDING (department-scope-coverage.test.ts:80, 51→50) ใน commit เดียวกัน
- dispense/route.ts: const scope = await getDepartmentScope(user) ส่ง arg ที่ 4 (ที่ :26) catch คง ctx.fail; mobile/confirm กิ่ง dispense (:77) ส่ง getDepartmentScope(user) หลัง RBAC (:68-70); catch (:87) บรรทัดแรก `if (isDepartmentScopeFailure(error)) return ctx.fail(error);`
- เทสต์: เติม {mode:"legacy"} ที่ stock-transactions.db.test.ts :48,53,59,64,70,76-79,81 และ dispense/route.test.ts:50 (ห้ามแก้ expect); เคสใหม่ one/denied(404)/READ_ONLY(409)/ITEM_NOT_IN_DEPARTMENT; ไฟล์ใหม่ stock-transactions.dept.db.test.ts (เคสตามหัวข้อเทสต์ใน v2)
- เคส 3 เขียนใหม่: seed แถว X ('MB-000001','L1',qty5,dept=A, ข้อมูลไม่ตรงกัน) + แถว Y ('MB-000001','L1',qty5,dept=B, received_on ต่างวัน กันชน UNIQUE pglite-prod-schema.ts:85); เรียก runDispenseBatch([{inventoryId:X.id,itemId:"MB-000001",lotNo:"L1",qty:2}],user,audit,ONE_B); คาด X ยัง 5, Y เหลือ 3, log 1 แถว dept=B; เคสย่อยไม่มี Y→LOT_NOT_AVAILABLE X ยัง 5
- เคส 2, 7 ตรวจ userMessage "รายการนี้ไม่อยู่ในงานของคุณ (…)"

## ขั้น 4 (commit d) รับเข้า — runReceiveBatch
- บรรทัดแรก writeDepartmentId(scope) แล้ว const d = deptInsert(scope); :79 WHERE ${deptWhere(scope)}
- หลัง :96 ก่อน :98: โหมด one มีรายการไม่อยู่ใน activeMap → AppError ITEM_NOT_IN_DEPARTMENT (ข้อความเดียวกับขั้น 3)
- ธุรกรรม :109-131 ต่อรายการ [masterAssert, ...crossDeptAssert, upsertAndLog]: master assert :111-115 andDeptWrite หลัง AND is_active = TRUE (:113) ก่อน FOR UPDATE (:114); crossDeptAssert (เฉพาะ scope.mode==="one", legacy=[]): `transaction\`SELECT labstock_assert(NOT EXISTS (SELECT 1 FROM inventory WHERE item_id=${item.itemId} AND lot_no=${item.lotNo} AND received_on=CURRENT_DATE AND department_id <> ${scope.departmentId}), 'ITEM_NOT_IN_DEPARTMENT: ' || ${item.itemId}) AS ok\``; INSERT inventory :119-120 `(item_id, lot_no, exp_date, quantity, received_on${d.column})` / `VALUES (..., CURRENT_DATE${d.value})`; INSERT logs :127-128 `..., ip_address${d.column})` / `SELECT ..., ${audit.ipAddress}${d.value} FROM upserted`
- receive/route.ts และ mobile/confirm กิ่ง receive (:76) ส่ง scope; เทสต์ receive/route.test.ts:50 เติม {mode:"legacy"} + เคสใหม่; เคส 6: error ผ่าน toApiError ได้ 409 "รายการนี้ไม่อยู่ในงานของคุณ (MB-000001)"

## ขั้น 5 (commit e) แจ้งเตือนของใกล้หมด — notifyLowStockForAffectedItems(itemIds, scope) (:26-72)
CTE :36-37 deptWhere; master :48-49 andDept(scope,"m"); ผู้รับ :59-64 ใช้ recipientDepartmentFilter(scope): legacy→sql`` (SQL เดิมทุกตัวอักษร); one→ sql` AND (u.role = 'Vendor' OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.username = n.username AND ud.department_id = ${scope.departmentId}))` ต่อท้าย WHERE n.notify_low_stock = true (:63). ผู้เรียก :154,:291 ส่ง scope. STOCK_* (:143-152,:280-289) ไม่แก้
เหตุผล: u.role คือ users.role ทั้งระบบ Vendor ผ่านทุกงานแล้วถูกกรองสินค้าที่ notifications.ts:142-145 (vendor-notification-scope.ts:13-31; Vendor ไม่มีชื่อ vendor = ไม่ได้อะไร fail-closed :3-5,21-22)
เทสต์ (dept DB test เคส 11 เขียนใหม่ + 11b): beforeAll หลัง seedTwoDepartments เพิ่ม users('mbvendor','x','MB Vendor user','Vendor', vendor 'MB Vendor') ไม่มีแถว user_departments; notification_settings notify_low_stock=true ของ solo1, solo2, user1, admin1, vendor1, mbvendor; เบิก MB-000001 ต่ำกว่าเกณฑ์โหมด one B; ตรวจ args notifyUsersVendorScoped ที่ mock: ผู้รับ={solo2,user1,vendor1,mbvendor}, ไม่มี solo1/admin1 (admin1 เป็นสมาชิกงาน 1 เท่านั้น department-fixtures.ts:50); เอา items/recipientRows ไปเรียก splitRecipientsByVendor/itemsForVendor ตัวจริง: mbvendor ได้เฉพาะ MB-000001, vendor1 ('Vendor A') ได้ว่าง; 11b legacy บน schema migrate แล้ว ผู้รับครบเหมือนเดิม; characterization STOCK_* ส่ง [] ยังผ่าน

## ขั้น 6 (commit f) mobile/confirm tests: เหมือน v2 + run ปฏิเสธด้วย AppError ITEM_NOT_IN_DEPARTMENT→409 ไทย; new Error("ITEM_NOT_IN_DEPARTMENT: X")→409 "รายการนี้ไม่อยู่ในงานของคุณ (X)"; DepartmentScopeError("DEPARTMENT_READ_ONLY")→409; characterization 3 เคสจากขั้น 1 ผ่านโดยไม่แก้; fail-closed (ready+ไม่มี scope→500 body ไม่มี username)

## ขั้น 7 (commit g) เอกสาร: เหมือน v2 + ข้อ 9 (ก-ค), Vendor ได้ LOW_STOCK ข้ามงานเฉพาะสินค้าตัวเอง, ข้อความใช้ "งาน" (เอกสารเดิมใช้ทั้ง "แผนก"/"งาน" ไม่แก้ส่วนเดิม), ห้ามเปิด flag ก่อน merge mobile-auth, query ความสอดคล้อง inventory vs master

## ขั้น 8 PR แยก feat/departments-mobile-auth
8a: department-context.ts แยก SQL :101-116 + ตรรกะ :118-160 เป็น resolveCore(lookup, requested, explicit, checkTokenExpiry); :122 เป็น `if (checkTokenExpiry && row.token_expiry && ...)`; resolveUserDepartment ส่ง checkTokenExpiry = q.token !== undefined; resolveDepartmentForVerifiedUser(verified) ส่ง lookup=sql`u.username = ${verified.username}`, null, false, false; เทสต์เพิ่ม: verified ไม่สน token_expiry ที่หมด (ตั้งอดีตให้ solo2→ยังได้ scope 2); ทาง token หมดอายุ→null เหมือนเดิม; 32 เทสต์เดิมผ่านโดยไม่แก้; เทสต์ solo2/user1/newbie/suspended/admin1/"USER1"→null
8b: หลัง route.ts:57-61 ถ้า await departmentsReady(): try { scoped = await resolveDepartmentForVerifiedUser(user) } catch(e){ if(!isMissingDepartmentSchemaError(e)) return ctx.fail(e); markDepartmentsNotReady(...) }; scoped===null→403 {error:"บัญชีนี้ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ"}; scoped→user=scoped; ctx.user=user; Vendor ตรวจ (user.globalRole ?? user.role)==="Vendor" (:63-65); roleHasMenu(user.role, mode) (:68) ด้วย role ประจำงาน; flag ปิดไม่เรียก resolver. เทสต์: resolver โยน new Error("connection reset")→ผ่าน ctx.fail body ไม่มีข้อความดิบ run ไม่ถูกเรียก; 42P01→legacy ({mode:"legacy"}); null→403; Vendor→403; username "user1" ทั้งที่ body "USER1"; LIFF ทางเดียวกัน; เทสต์สแกน src: มีแค่ mobile/confirm/route.ts import resolveDepartmentForVerifiedUser (ห้าม mobile/line-link/route.ts:23, stations/authorize-user/route.ts:25, mobile/line-auth/route.ts:14, line-webhook/route.ts:150,292); ลบเทสต์ fail-closed ของขั้น 6 แทนด้วยชุดนี้
8c: เหมือน v2 + ระบุว่ามือถือใช้งาน default ของผู้อนุมัติ (ไม่มีการเลือกงาน)

## ขั้น 9 ซ้อม Neon: เหมือน v2 (ผู้นำ/ผู้ใช้ทำ ต้องขออนุมัติทุกครั้ง ไม่ใช่งาน coder)

## เกณฑ์ยอมรับ/รัศมี/ความเสี่ยง: เหมือน v2 + การแปลง DepartmentScopeError→HTTP มีที่เดียว; ไม่มีคำว่า "ห้อง"/"ที่คุณเลือก" ในข้อความผู้ใช้; Vendor ได้ LOW_STOCK ข้ามงานโดยเจตนา (Q-V); departmentErrorResponse เปลี่ยนไส้แต่ผลเท่าเดิม
สมมติฐานยังไม่ยืนยัน: S1 schema notification_settings บน Neon จริง (ยืนยันตอนขั้น 9); S2 Neon ต่อชิ้น SQL ใน transaction ได้ (ยังไม่รัน — coder ต้องยืนยันด้วยเทสต์ PGlite); S3 Vendor = users.role='Vendor' ทั้งระบบ (effectiveRole department-context.ts:59-64)
