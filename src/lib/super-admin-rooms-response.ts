import { apiError } from "@/lib/api-response";
import type { RoomFailure } from "@/lib/super-admin-rooms";

// Maps a room failure to the API error the Super admin screen shows. The confirmation case carries `needsConfirmation`
// so the screen can ask "close this room?" and send the same request again with confirmDeactivate = true.

export const SCHEMA_MISSING_MESSAGE = "ฐานข้อมูลยังไม่ได้อัปเกรดให้รองรับการจัดการห้อง (migration v30–v37 ยังไม่ครบ) กรุณาแจ้งผู้ดูแลระบบ";

const BLOCKED_MESSAGES: Record<"code-locked" | "needs-confirmation" | "code-required" | "letterhead-missing" | "letterhead-exists" | "schema-missing", string> = {
  "code-locked": "รหัสห้องตั้งแล้วเปลี่ยนไม่ได้",
  "needs-confirmation": "ห้องนี้มีสมาชิกอยู่ การปิดห้องจะทำให้สมาชิกเข้าห้องนี้ไม่ได้ กรุณายืนยันก่อน",
  "code-required": "ต้องตั้งรหัสห้องก่อนจึงจะเปิดใช้งานได้",
  "letterhead-missing": "ห้องนี้ยังไม่มีหัวกระดาษใบสั่งซื้อ จึงตั้งรหัสหรือเปิดใช้งานไม่ได้ ให้สร้างหัวกระดาษก่อน",
  "letterhead-exists": "ห้องนี้มีหัวกระดาษใบสั่งซื้ออยู่แล้ว",
  "schema-missing": SCHEMA_MISSING_MESSAGE,
};

export function roomFailureResponse(failure: RoomFailure, requestId: string) {
  switch (failure) {
    case "validation":
      return apiError("VALIDATION_FAILED", { requestId });
    case "duplicate":
      return apiError("DUPLICATE_ENTRY", { requestId, message: "ชื่อห้องหรือรหัสห้องนี้มีอยู่แล้ว" });
    case "not-found":
      return apiError("DEPARTMENT_NOT_FOUND", { requestId });
    case "protected":
      return apiError("FORBIDDEN", { requestId, message: "ห้องเริ่มต้น (CC) แก้ไขหรือปิดจากหน้านี้ไม่ได้ และห้องอื่นใช้รหัส CC ไม่ได้" });
    default:
      return apiError("ROOM_RULE_BLOCKED", {
        requestId,
        message: BLOCKED_MESSAGES[failure],
        extra: failure === "needs-confirmation" ? { needsConfirmation: true } : undefined,
      });
  }
}
