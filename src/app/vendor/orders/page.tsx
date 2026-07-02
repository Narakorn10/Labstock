"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import {
  ShoppingCart,
  Clock,
  Package,
  CheckCircle2,
  XCircle,
  Calendar,
  AlertCircle,
  RefreshCw,
  FileText,
  ChevronRight,
  Loader2,
  Inbox,
} from "lucide-react";

interface VendorPurchaseOrderItem {
  id: number;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
}

interface VendorPurchaseOrder {
  id: string;
  po_number: string;
  status: "SUBMITTED" | "CONFIRMED" | "SHIPPED" | "RECEIVED" | "REJECTED";
  created_at: string;
  expected_date?: string | null;
  note?: string | null;
  items?: VendorPurchaseOrderItem[];
}

export default function VendorOrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<VendorPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchOrders = useCallback(async (vendor: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders?vendor=${vendor}`);
      if (res.ok) {
        const data = (await res.json()) as VendorPurchaseOrder[];
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || user?.role !== "Vendor" || !user.vendor) {
      return;
    }

    let active = true;

    const loadOrders = async () => {
      if (active) {
        setLoading(true);
      }

      try {
        const res = await fetch(`/api/purchase-orders?vendor=${user.vendor}`);
        if (res.ok) {
          const data = (await res.json()) as VendorPurchaseOrder[];
          if (active) {
            setOrders(Array.isArray(data) ? data : []);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadOrders();

    return () => {
      active = false;
    };
  }, [authLoading, fetchOrders, user]);

  const updatePOStatus = async (id: string, status: string, note: string = "") => {
    if (!confirm(`à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ªà¸–à¸²à¸™à¸°à¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¹€à¸›à¹‡à¸™ ${status} à¸«à¸£à¸·à¸­à¹„à¸¡à¹ˆ?`)) {
      return;
    }

    setUpdating(id);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, vendor_note: note }),
      });
      if (res.ok) {
        if (user?.vendor) {
          await fetchOrders(user.vendor);
        }
      } else {
        alert("à¸­à¸±à¸žà¹€à¸”à¸—à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ");
      }
    } catch (e) {
      console.error(e);
      alert("à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸”à¹ƒà¸™à¸à¸²à¸£à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­");
    } finally {
      setUpdating(null);
    }
  };

  if (authLoading || (user?.role === "Vendor" && loading && !orders.length)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="animate-spin text-blue-600" size={40} />
        <p className="text-gray-500 font-bold">à¸à¸³à¸¥à¸±à¸‡à¹‚à¸«à¸¥à¸”à¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­...</p>
      </div>
    );
  }

  if (!user || user.role !== "Vendor") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertCircle className="text-red-500" size={48} />
        <p className="text-gray-900 font-bold text-xl">à¸ªà¸´à¸—à¸˜à¸´à¹Œà¸à¸²à¸£à¹€à¸‚à¹‰à¸²à¸–à¸¶à¸‡à¹€à¸‰à¸žà¸²à¸° Vendor à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200">
              <ShoppingCart size={24} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">à¸£à¸±à¸šà¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­ (Purchase Orders)</h1>
          </div>
          <p className="text-gray-500 text-sm ml-12">à¸£à¸²à¸¢à¸à¸²à¸£à¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¸ˆà¸²à¸à¸«à¹‰à¸­à¸‡ Lab à¸—à¸µà¹ˆà¸ªà¹ˆà¸‡à¸–à¸¶à¸‡ {user.vendor}</p>
        </div>

        <button
          onClick={() => user.vendor && void fetchOrders(user.vendor)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all shadow-sm"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          à¸£à¸µà¹€à¸Ÿà¸£à¸Šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥
        </button>
      </div>

      <div className="space-y-6">
        {orders.length === 0 ? (
          <div className="bg-white p-16 text-center rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center gap-4">
            <div className="bg-gray-50 p-6 rounded-full text-gray-300">
              <Inbox size={64} />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-gray-900">à¹„à¸¡à¹ˆà¸¡à¸µà¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¹ƒà¸«à¸¡à¹ˆ</h3>
              <p className="text-gray-500">à¹€à¸¡à¸·à¹ˆà¸­ Lab à¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸šà¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¹ƒà¸«à¸¡à¹ˆ à¸£à¸²à¸¢à¸à¸²à¸£à¸ˆà¸°à¸›à¸£à¸²à¸à¸à¸—à¸µà¹ˆà¸™à¸µà¹ˆà¸„à¸£à¸±à¸š</p>
            </div>
          </div>
        ) : (
          orders.map((po) => {
            const isSubmitted = po.status === "SUBMITTED";
            const isConfirmed = po.status === "CONFIRMED";

            return (
              <div
                key={po.id}
                className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden hover:border-blue-200 transition-all group"
              >
                <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black text-blue-600 tracking-tight">{po.po_number}</h2>
                      <span
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                          po.status === "SUBMITTED"
                            ? "bg-amber-100 text-amber-700"
                            : po.status === "CONFIRMED"
                              ? "bg-blue-100 text-blue-700"
                              : po.status === "SHIPPED"
                                ? "bg-indigo-100 text-indigo-700"
                                : po.status === "RECEIVED"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {po.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Calendar size={16} className="text-gray-400" />
                        <span className="text-xs font-bold">à¸ªà¸£à¹‰à¸²à¸‡à¹€à¸¡à¸·à¹ˆà¸­: {new Date(po.created_at).toLocaleString("th-TH")}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-500">
                        <Clock size={16} className="text-gray-400" />
                        <span className="text-xs font-bold">
                          à¸à¸³à¸«à¸™à¸”à¸ªà¹ˆà¸‡: {po.expected_date ? new Date(po.expected_date).toLocaleDateString("th-TH") : "-"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col justify-center gap-2">
                    {isSubmitted && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void updatePOStatus(po.id, "CONFIRMED")}
                          disabled={updating === po.id}
                          className="flex-1 md:flex-none px-6 py-2.5 bg-green-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-green-100 hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                        >
                          {updating === po.id ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                          à¸¢à¸·à¸™à¸¢à¸±à¸™à¸£à¸±à¸šà¸­à¸­à¹€à¸”à¸­à¸£à¹Œ
                        </button>
                        <button
                          onClick={() => {
                            const note = prompt("à¸£à¸°à¸šà¸¸à¹€à¸«à¸•à¸¸à¸œà¸¥à¸—à¸µà¹ˆà¸›à¸à¸´à¹€à¸ªà¸˜ (à¹€à¸Šà¹ˆà¸™ à¸ªà¸´à¸™à¸„à¹‰à¸²à¸«à¸¡à¸”):");
                            if (note !== null) {
                              void updatePOStatus(po.id, "REJECTED", note);
                            }
                          }}
                          disabled={updating === po.id}
                          className="px-4 py-2.5 bg-red-50 text-red-600 text-sm font-bold rounded-xl hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                        >
                          <XCircle size={18} />
                          à¸›à¸à¸´à¹€à¸ªà¸˜
                        </button>
                      </div>
                    )}
                    {isConfirmed && (
                      <button
                        onClick={() => router.push("/vendor/shipments")}
                        className="w-full px-6 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                      >
                        <Package size={18} />
                        à¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸šà¸ªà¹ˆà¸‡à¸‚à¸­à¸‡
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {po.note && (
                  <div className="mx-6 md:mx-8 mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-black text-amber-700 uppercase tracking-tighter">à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸à¸ˆà¸²à¸ Lab</p>
                      <p className="text-sm text-amber-900 font-medium">{po.note}</p>
                    </div>
                  </div>
                )}

                <div className="border-t border-gray-100 bg-gray-50/30">
                  <div className="px-6 md:px-8 py-4 flex items-center gap-2 border-b border-gray-100">
                    <FileText size={16} className="text-gray-400" />
                    <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">à¸£à¸²à¸¢à¸à¸²à¸£à¸ªà¸´à¸™à¸„à¹‰à¸² (Items)</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 text-[10px] font-black uppercase tracking-widest">
                          <th className="px-8 py-4">à¸£à¸«à¸±à¸ª</th>
                          <th className="px-8 py-4">à¸Šà¸·à¹ˆà¸­à¸™à¹‰à¸³à¸¢à¸²</th>
                          <th className="px-8 py-4 text-right">à¸ˆà¸³à¸™à¸§à¸™</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {po.items?.map((item) => (
                          <tr key={item.id} className="hover:bg-white transition-colors">
                            <td className="px-8 py-4 font-mono text-gray-500">{item.item_id}</td>
                            <td className="px-8 py-4 font-bold text-gray-900">{item.item_name}</td>
                            <td className="px-8 py-4 text-right">
                              <span className="text-lg font-black text-blue-600">{item.quantity}</span>
                              <span className="ml-2 text-xs font-bold text-gray-400 uppercase">{item.unit}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
