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
  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500"><Loader2 className="mr-2 inline animate-spin" size={16} />กำลังโหลดรายการค้าง</div>;
  if (!loans.length) return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">ไม่มีรายการค้าง</div>;

  return <div className="space-y-2">{loans.map((loan) => {
    const lentOut = loan.direction === "LENT_OUT";
    return <button key={loan.id} type="button" onClick={() => onSelect?.(loan)} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-default" disabled={!onSelect}>
      <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{loan.item_name}</p><p className="mt-1 text-xs text-slate-500">{loan.partner_name} · Lot {loan.lot_no || "-"}</p></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${lentOut ? "bg-violet-100 text-violet-800" : "bg-blue-100 text-blue-800"}`}>{lentOut ? <ArrowUpFromLine size={13} /> : <ArrowDownToLine size={13} />}{loan.remaining_qty}</span></div>
      <p className="mt-2 text-xs text-slate-500">บันทึกเมื่อ {new Date(loan.loaned_at).toLocaleDateString("th-TH")}{onSelect ? " · กดเพื่อเลือกรายการคืน" : ""}</p>
    </button>;
  })}</div>;
}
