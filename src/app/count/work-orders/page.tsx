"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { apiClient, type CountWorkOrderSummary } from "@/lib/api-client";

export default function CountWorkOrdersPage() {
  const [orders, setOrders] = useState<CountWorkOrderSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { apiClient.listCountWorkOrders().then(setOrders).catch((e) => setError(e.response?.data?.error || "โหลดใบงานไม่สำเร็จ")); }, []);
  if (error) return <p className="rounded-xl bg-red-50 p-5 font-bold text-red-700">{error}</p>;
  if (!orders.length) return <div className="flex min-h-64 items-center justify-center gap-3 text-gray-500"><Loader2 className="animate-spin" />กำลังโหลดใบงาน...</div>;
  return <section className="mx-auto max-w-5xl space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-black">ใบงานนับสต็อกของฉัน</h1><p className="text-sm text-gray-500">เปิดใบงานเพื่อแก้ยอด เลือก Lot หรือยืนยันเบิก</p></div><Link href="/count" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">นับสต็อกใหม่</Link></div><div className="grid gap-3">{orders.map((order) => <Link key={order.id} href={`/count/work-orders/${order.id}`} className="flex items-center justify-between rounded-2xl border bg-white p-5 shadow-sm hover:border-blue-300"><div className="flex gap-3"><ClipboardList className="text-blue-600" /><div><p className="font-black">{order.jobType || "ทุกหน่วยงาน"}</p><p className="text-xs text-gray-500">ผู้สร้าง: {order.ownerUsername} · {order.itemCount} รายการ</p></div></div><span className={`rounded-full px-3 py-1 text-xs font-black ${order.status === "OPEN" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{order.status}</span></Link>)}</div></section>;
}
