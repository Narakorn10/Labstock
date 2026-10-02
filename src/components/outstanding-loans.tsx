"use client";

import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";

export type OutstandingLoan = {
  id: number;
  direction: "BORROWED_IN" | "LENT_OUT";
  partner_name: string;
  item_id: string;
  item_name: string;
  lot_no: string;
  exp_date: string | null;
  remaining_qty: number;
  loaned_at: string;
};

type Props = {
  loans: OutstandingLoan[];
  loading?: boolean;
  onSelect?: (loan: OutstandingLoan) => void;
};

export default function OutstandingLoans({ loans, loading = false, onSelect }: Props) {
  if (loading) return <div className="rounded-xl border border-line bg-white p-4 text-sm text-gray-600"><Loader2 className="mr-2 inline animate-spin" size={16} />กำลังโหลดรายการค้าง</div>;
  if (!loans.length) return <div className="rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-8 text-sm text-gray-600">ไม่มีรายการค้าง</div>;

  return <div className="space-y-2">{loans.map((loan) => {
    const lentOut = loan.direction === "LENT_OUT";
    return <button key={loan.id} type="button" onClick={() => onSelect?.(loan)} className="flex w-full flex-wrap items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 py-3 text-left transition hover:border-gray-400 hover:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-800 disabled:cursor-default" disabled={!onSelect}>
      <span className="min-w-0 flex-[1_1_240px]">
        <span className="block font-medium text-ink">{loan.item_name}</span>
        <span className="block text-xs text-gray-600">{loan.partner_name} · Lot {loan.lot_no || "-"} · เริ่ม {new Date(loan.loaned_at).toLocaleDateString("th-TH")}</span>
      </span>
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium text-ink">{lentOut ? <ArrowUpFromLine size={13} /> : <ArrowDownToLine size={13} />}คงค้าง {loan.remaining_qty}</span>
      {onSelect && <span className="text-[13px] text-blue-700">เลือกเพื่อ{lentOut ? "รับคืน" : "ส่งคืน"}</span>}
    </button>;
  })}</div>;
}
