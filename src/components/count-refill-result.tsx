"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle } from "lucide-react";
import Modal from "@/components/modal";
import type { ConfirmFailure, ConfirmFailureReason } from "@/lib/count-work-orders";

export type RefillProblemKind = ConfirmFailureReason | "NO_STOCK" | "PARTIAL_STOCK" | "ERROR";

export interface RefillProblem {
  itemId: string;
  name: string;
  kind: RefillProblemKind;
  requiredQty?: number | null;
  available?: number;
  detail?: string;
}

export interface RefillOutcome {
  workOrderId: number | null;
  jobType?: string;
  dispensed: Array<{ itemId: string; name: string; qty: number }>;
  problems: RefillProblem[];
}

export const problemsFromFailures = (failed: ConfirmFailure[]): RefillProblem[] => failed.map((item) => ({
  itemId: item.itemId, name: item.name || item.itemId, kind: item.reason, requiredQty: item.requiredQty, available: item.available,
}));

// A 409 from the confirm API carries per-item reasons; anything else becomes one general error.
export const problemsFromError = (error: unknown): RefillProblem[] => {
  const response = error as { response?: { status?: number; data?: { error?: string; failed?: ConfirmFailure[] } }; message?: string };
  const failed = response.response?.data?.failed;
  if (response.response?.status === 409 && failed?.length) return problemsFromFailures(failed);
  return [{ itemId: "", name: "", kind: "ERROR", detail: response.response?.data?.error || response.message || "ไม่ทราบสาเหตุ" }];
};

const orderLabel = (workOrderId: number | null) => (workOrderId ? `ใบงาน #${workOrderId}` : "ใบงาน");

function describe(problem: RefillProblem, workOrderId: number | null) {
  const order = orderLabel(workOrderId);
  switch (problem.kind) {
    case "NO_STOCK":
      return { reason: "ไม่มี Lot ในคลังกลาง", next: `รอรับของเข้าคลังหลัก (หรือแจ้งฝ่ายจัดซื้อ) แล้วเปิด${order} กดยืนยันเบิกอีกครั้ง รายการนี้ยังค้างอยู่ในใบงาน` };
    case "PARTIAL_STOCK":
      return { reason: `คลังกลางมี ${problem.available ?? 0} จากที่ต้องเบิก ${problem.requiredQty ?? "-"}`, next: `ระบบเบิกเฉพาะรายการที่ครบ รอรับของเพิ่มแล้วเปิด${order} กดยืนยันเบิกอีกครั้ง` };
    case "INSUFFICIENT":
      return { reason: `Lot ถูกเบิกไปก่อนหน้า เหลือ ${problem.available ?? 0} จากที่ต้องเบิก ${problem.requiredQty ?? "-"}`, next: `เปิด${order} กด "โหลด Lot ล่าสุด" แล้วยืนยันอีกครั้ง` };
    case "LOT_INVALID":
      return { reason: "Lot ที่เลือกไม่มีแล้วหรือไม่ใช่ของน้ำยานี้", next: `เปิด${order} กด "โหลด Lot ล่าสุด" แล้วยืนยันอีกครั้ง` };
    case "QTY_MISMATCH":
      return { reason: "ยอดที่ส่งไม่ตรงกับยอดที่ต้องเบิกในใบงาน", next: "รีเฟรชหน้า ตรวจยอดนับให้ถูกต้อง แล้วยืนยันอีกครั้ง" };
    case "INACTIVE":
      return { reason: "น้ำยาถูกปิดใช้งานแล้ว", next: "ไม่ต้องเบิก หากยังใช้งานอยู่ ให้ Admin/Manager เปิดใช้งานที่หน้า Master Data" };
    case "NOT_PENDING":
      return { reason: "เบิกไปแล้วในใบงานนี้ หรือไม่มีในใบงาน", next: "ไม่ต้องทำอะไรเพิ่ม ดูประวัติได้ในส่วน \"เบิกแล้ว\" ของใบงาน" };
    default:
      return { reason: problem.detail || "เกิดข้อผิดพลาด", next: "ลองใหม่อีกครั้ง หากยังไม่สำเร็จ ให้แจ้งผู้ดูแลระบบพร้อมเลขใบงาน" };
  }
}

export default function CountRefillResult({ outcomes, onClose, showOrderLinks = true }: { outcomes: RefillOutcome[] | null; onClose: () => void; showOrderLinks?: boolean }) {
  const dispensed = outcomes?.flatMap((outcome) => outcome.dispensed) || [];
  const problemCount = outcomes?.reduce((sum, outcome) => sum + outcome.problems.length, 0) || 0;
  const title = problemCount === 0 ? "เบิกเติมสำเร็จ" : dispensed.length ? "เบิกได้บางรายการ" : "ยังเบิกไม่สำเร็จ";

  return (
    <Modal isOpen={Boolean(outcomes)} onClose={onClose} title={title} maxWidth="max-w-2xl">
      {outcomes && (
        <div className="space-y-5">
          {dispensed.length > 0 && (
            <section className="rounded-2xl border border-ok/20 bg-ok-bg p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-ok"><CheckCircle size={18} />เบิกสำเร็จ {dispensed.length} รายการ (บันทึกในประวัติแล้ว)</p>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {dispensed.map((item) => <li key={item.itemId} className="flex justify-between gap-3"><span>{item.name}</span><span className="font-medium">{item.qty}</span></li>)}
              </ul>
            </section>
          )}

          {problemCount > 0 && (
            <section className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium text-warn"><AlertTriangle size={18} />ยังไม่ได้เบิก {problemCount} รายการ</p>
              {outcomes.map((outcome) => outcome.problems.map((problem, index) => {
                const { reason, next } = describe(problem, outcome.workOrderId);
                return (
                  <div key={`${outcome.workOrderId}-${problem.itemId}-${index}`} className="rounded-2xl border border-warn/30 bg-warn-bg p-4 text-sm">
                    {problem.name && <p className="font-medium text-ink">{problem.name}</p>}
                    <p className="mt-1 text-warn">{reason}</p>
                    <p className="mt-2 text-gray-700"><span className="font-medium">ทำต่อ:</span> {next}</p>
                  </div>
                );
              }))}
            </section>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {showOrderLinks && outcomes.filter((outcome) => outcome.workOrderId && outcome.problems.length).map((outcome) => (
              <Link key={outcome.workOrderId} href={`/count/work-orders/${outcome.workOrderId}`} className="rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink hover:bg-gray-50">
                เปิด{orderLabel(outcome.workOrderId)}{outcome.jobType ? ` (${outcome.jobType})` : ""}
              </Link>
            ))}
            <button type="button" onClick={onClose} className="rounded-[10px] bg-ink px-4 py-[9px] text-sm font-medium text-white hover:bg-black">ปิด</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
