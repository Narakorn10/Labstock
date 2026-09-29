// Types and labels shared by the activity API and page. No server imports here, so it is safe in client bundles.

export type AppEventOutcomeFilter = "success" | "rejected" | "error" | "failed";

export interface AppEventRow {
  id: number;
  createdAt: string;
  requestId: string | null;
  username: string | null;
  role: string | null;
  action: string;
  route: string;
  method: string | null;
  outcome: "success" | "rejected" | "error";
  status: number | null;
  message: string | null;
  details: Record<string, unknown>;
  durationMs: number | null;
}

export interface RepeatedFailure {
  action: string;
  message: string | null;
  occurrences: number;
  users: number;
  lastSeen: string;
}

export interface AppEventsResponse {
  items: AppEventRow[];
  nextCursor: number | null;
  repeated: RepeatedFailure[];
}

export const APP_EVENT_ACTION_LABELS: Record<string, string> = {
  "count.save": "นับสต็อก: บันทึกใบงาน",
  "count.edit": "นับสต็อก: แก้ไขใบงาน",
  "count.cancel": "นับสต็อก: ยกเลิกใบงาน",
  "count.confirm": "นับสต็อก: ยืนยันเบิกเติม",
  dispense: "เบิกน้ำยา",
  receive: "รับเข้าน้ำยา",
  "mobile.confirm": "ยืนยันผ่านมือถือ/LINE",
};

export const APP_EVENT_OUTCOME_LABELS: Record<string, string> = {
  success: "สำเร็จ",
  rejected: "ถูกปฏิเสธ",
  error: "ระบบผิดพลาด",
};
