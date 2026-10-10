/**
 * Central catalogue of user-facing errors. Safe to import from client code: no server imports here.
 * `message` is what the user sees (Thai); `hint` is a basic troubleshooting step in plain language.
 */

export interface ErrorDef {
  status: number;
  message: string;
  hint: string;
}

export const ERROR_CATALOGUE = {
  AUTH_REQUIRED: { status: 401, message: "กรุณาเข้าสู่ระบบก่อนใช้งาน", hint: "ล็อกอินใหม่อีกครั้งแล้วลองทำรายการอีกรอบ" },
  SESSION_EXPIRED: { status: 401, message: "การเข้าสู่ระบบหมดอายุ", hint: "ล็อกอินใหม่อีกครั้ง แล้วทำรายการต่อได้เลย" },
  INVALID_CREDENTIALS: { status: 401, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", hint: "ตรวจสอบชื่อผู้ใช้และรหัสผ่าน (ระวังตัวพิมพ์เล็ก/ใหญ่ และภาษาแป้นพิมพ์) แล้วลองใหม่" },
  FORBIDDEN: { status: 403, message: "คุณไม่มีสิทธิ์ทำรายการนี้", hint: "หากต้องใช้เมนูนี้ ให้แจ้งผู้ดูแลระบบเพื่อขอสิทธิ์เพิ่ม" },
  ACCOUNT_SUSPENDED: { status: 403, message: "บัญชีนี้ถูกระงับการใช้งาน", hint: "ติดต่อผู้ดูแลระบบเพื่อตรวจสอบสถานะบัญชี" },
  VALIDATION_FAILED: { status: 400, message: "ข้อมูลที่กรอกไม่ถูกต้องหรือไม่ครบ", hint: "ตรวจสอบช่องที่ต้องกรอกและจำนวนให้ครบถ้วน แล้วกดบันทึกใหม่" },
  INVALID_JSON: { status: 400, message: "ระบบอ่านข้อมูลที่ส่งมาไม่ได้", hint: "รีเฟรชหน้าจอ (กด F5) แล้วทำรายการใหม่ ถ้ายังเป็นอีกให้แจ้งผู้ดูแลระบบ" },
  DUPLICATE_ENTRY: { status: 409, message: "มีข้อมูลนี้อยู่ในระบบแล้ว", hint: "ตรวจสอบว่าเคยบันทึกรายการนี้ไปแล้วหรือยัง หรือเปลี่ยนรหัส/เลขที่ให้ไม่ซ้ำ" },
  REAGENT_INACTIVE: { status: 409, message: "สารเคมีรายการนี้ถูกปิดใช้งานแล้ว", hint: "เลือกรายการอื่น หรือให้ผู้ดูแลระบบเปิดใช้งานรายการนี้อีกครั้ง" },
  REAGENT_STOCK_INSUFFICIENT: { status: 409, message: "จำนวนคงเหลือไม่พอสำหรับรายการที่เบิก", hint: "ตรวจสอบจำนวนคงเหลือล่าสุด ลดจำนวนที่เบิก หรือเลือก Lot อื่น" },
  LOT_NOT_AVAILABLE: { status: 409, message: "ไม่พบ Lot ที่พร้อมใช้งาน", hint: "ตรวจสอบเลข Lot ที่เลือก อาจหมดแล้วหรือถูกเบิกไปก่อนหน้า ลองโหลดรายการใหม่" },
  ITEM_NOT_FOUND: { status: 404, message: "ไม่พบรายการสารเคมี", hint: "ตรวจสอบรหัสรายการ หรือรีเฟรชหน้าจอแล้วลองใหม่" },
  STOCK_CHANGED: { status: 409, message: "จำนวนคงเหลือมีการเปลี่ยนแปลงระหว่างทำรายการ", hint: "รีเฟรชหน้าจอเพื่อดูจำนวนล่าสุด แล้วทำรายการอีกครั้ง" },
  COUNT_ORDER_NOT_FOUND: { status: 404, message: "ไม่พบใบสั่งนับสต็อกนี้ หรือปิดไปแล้ว", hint: "กลับไปหน้ารายการใบสั่งนับ แล้วเลือกใบที่ยังเปิดอยู่" },
  COUNT_NOTHING_TO_DISPENSE: { status: 409, message: "ไม่มีรายการที่เบิกได้ในใบนับนี้", hint: "ตรวจสอบรายการและยอดจัดสรร Lot ตามที่ระบบแจ้ง แล้วลองยืนยันใหม่" },
  PO_NOT_FOUND: { status: 404, message: "ไม่พบใบสั่งซื้อนี้", hint: "รีเฟรชหน้าจอ หรือค้นหาเลขที่ใบสั่งซื้อใหม่อีกครั้ง" },
  PO_STATE_CONFLICT: { status: 409, message: "สถานะใบสั่งซื้อไม่ตรงกับการดำเนินการนี้", hint: "รีเฟรชหน้าจอเพื่อดูสถานะล่าสุด อาจมีผู้อื่นดำเนินการไปแล้ว" },
  AI_UNAVAILABLE: { status: 503, message: "บริการ AI ใช้งานไม่ได้ชั่วคราว", hint: "รอสักครู่แล้วลองใหม่ หรือกรอกข้อมูลด้วยตนเองไปก่อน" },
  RATE_LIMITED: { status: 429, message: "ทำรายการถี่เกินไป", hint: "รอประมาณ 1 นาทีแล้วลองใหม่" },
  SHIPMENT_NOT_FOUND: { status: 404, message: "ไม่พบรายการจัดส่งนี้", hint: "รีเฟรชหน้าจอ หรือตรวจสอบกับผู้ขายว่ายังมีรายการอยู่หรือไม่" },
  // Status 409 matches what the vendor shipments routes return today.
  SHELF_LIFE_BELOW_MINIMUM: { status: 409, message: "อายุคงเหลือของสินค้าต่ำกว่าเกณฑ์ขั้นต่ำของห้องปฏิบัติการ", hint: "ตรวจสอบวันหมดอายุของ Lot หรือระบุเหตุผลการรับแบบยกเว้น (หากมีสิทธิ์)" },
  DB_UNAVAILABLE: { status: 503, message: "ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว", hint: "รอสักครู่ แล้วตรวจสอบสต็อก/ประวัติว่ารายการที่ทำถูกบันทึกแล้วหรือยัง ก่อนกดทำซ้ำ เพื่อไม่ให้บันทึกซ้ำ ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ" },
  // Client-only codes (no HTTP response exists).
  NETWORK_OFFLINE: { status: 0, message: "เชื่อมต่ออินเทอร์เน็ตไม่ได้", hint: "ตรวจสอบสัญญาณ Wi-Fi/เครือข่าย แล้วลองใหม่ รายการที่ยังไม่บันทึกอาจต้องทำซ้ำ" },
  TIMEOUT: { status: 0, message: "ระบบตอบสนองช้าเกินไป", hint: "รอสักครู่แล้วตรวจสอบว่ารายการถูกบันทึกหรือยัง ก่อนกดทำซ้ำ เพื่อไม่ให้บันทึกซ้ำ" },
  DEPARTMENT_NOT_FOUND: { status: 404, message: "ไม่พบงานที่ขอ หรือคุณไม่มีสิทธิ์เข้าถึงงานนี้", hint: "เลือกงานจากรายการงานของคุณอีกครั้ง ถ้าควรมีสิทธิ์ให้แจ้งผู้ดูแลระบบ" },
  DEPARTMENT_READ_ONLY: { status: 409, message: "โหมดดูทุกงานเป็นแบบอ่านอย่างเดียว กรุณาเลือกงานก่อนบันทึก", hint: "เลือกงานที่ต้องการในเมนูด้านซ้าย แล้วทำรายการอีกครั้ง" },
  DEPARTMENTS_DISABLED: { status: 409, message: "ระบบหลายงานยังไม่เปิดใช้งาน", hint: "แจ้งผู้ดูแลระบบให้เปิดใช้งานระบบหลายงานก่อน" },
  INTERNAL_ERROR: { status: 500, message: "ระบบขัดข้อง ไม่สามารถทำรายการได้", hint: "ลองใหม่อีกครั้ง ถ้ายังเป็นอีกให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง (Request ID)" },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ERROR_CATALOGUE, code);
}

export function getErrorDef(code: string): ErrorDef {
  return isErrorCode(code) ? ERROR_CATALOGUE[code] : ERROR_CATALOGUE.INTERNAL_ERROR;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly hint: string;
  readonly extra: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    opts: { message?: string; hint?: string; detail?: string; cause?: unknown; extra?: Record<string, unknown> } = {},
  ) {
    const def = getErrorDef(code);
    super(opts.detail ?? code, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = def.status;
    this.userMessage = opts.message ?? def.message;
    this.hint = opts.hint ?? def.hint;
    this.extra = opts.extra ?? {};
  }
}
