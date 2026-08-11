"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

type PurchaseOrderStatus = "PENDING_MANAGER_REVIEW" | "PENDING_LAB_REVIEW" | "SUBMITTED" | "ACKNOWLEDGED" | "REVISION_REQUESTED" | "CONFIRMED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "REJECTED";

interface PurchaseOrderItemDraft {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  policy_order_qty?: number;
  dynamic_order_qty?: number;
  selected_basis?: "POLICY" | "DYNAMIC" | "MANUAL";
  override_reason?: string;
  confidence?: "high" | "low" | "none";
  review_reasons?: string[];
  requires_review?: boolean;
  suggestion_context?: SuggestionContext;
}

interface SuggestionContext {
  daily_demand_boxes: number;
  demand_source: "actual_dispense_history" | "approved_policy" | "documented_withdrawal" | "policy_formula" | "weekly_target";
  projected_balance_at_horizon: number;
  safety_stock_boxes: number;
  lead_time_days: number;
  horizon_days: number;
  expiry_assessment: {
    expired_qty_excluded: number;
    expiring_within_horizon_qty: number;
    nearest_expiry_date: string | null;
  };
}

interface PurchaseOrderSummary {
  id: number;
  po_number: string;
  vendor: string;
  status: PurchaseOrderStatus;
  proposal_origin?: "LAB" | "VENDOR";
  created_at: string;
  expected_date?: string | null;
  note?: string | null;
  items?: PurchaseOrderItemDraft[];
}

interface SuggestedPurchaseOrderItem {
  item_id: string;
  name: string;
  suggested_order_qty: number;
  unit: string;
  vendor?: string;
  policy_order_qty: number;
  dynamic_order_qty: number;
  variance_percent: number | null;
  confidence: "high" | "low" | "none";
  review_reasons: string[];
  auto_selectable: boolean;
  expedite_required: boolean;
  projected_balance_at_horizon: number;
  safety_stock_boxes: number;
  lead_time_days: number;
  horizon_days: number;
  expiry_assessment: SuggestionContext["expiry_assessment"];
  calculation_breakdown: {
    demandSource: SuggestionContext["demand_source"];
    dailyDemandBoxes: number;
  };
}

const demandSourceLabels: Record<SuggestionContext["demand_source"], string> = {
  actual_dispense_history: "ยอดเบิกจริง",
  approved_policy: "แผนที่แล็บอนุมัติ",
  documented_withdrawal: "ยอดเบิกที่บันทึกไว้",
  policy_formula: "สูตรปริมาณตรวจและ IQC",
  weekly_target: "เป้าหมายรายสัปดาห์",
};

function formatExpiryDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

interface OrderFormOptions {
  vendors: string[];
}

interface CatalogReagent {
  itemId: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
  vendor?: string;
  reagentType?: string;
  jobType?: string;
}

const statusLabels: Record<PurchaseOrderStatus, string> = {
  PENDING_MANAGER_REVIEW: "รอหัวหน้าตรวจสอบก่อนส่งบริษัท",
  PENDING_LAB_REVIEW: "รอแล็บตรวจสอบ",
  SUBMITTED: "ส่งให้บริษัทแล้ว",
  ACKNOWLEDGED: "บริษัทรับทราบแล้ว",
  REVISION_REQUESTED: "บริษัทแก้ไข รอแล็บยืนยัน",
  CONFIRMED: "ยืนยันแล้ว",
  PARTIALLY_SHIPPED: "จัดส่งบางส่วน",
  SHIPPED: "จัดส่งแล้ว",
  PARTIALLY_RECEIVED: "รับเข้าแล้วบางส่วน",
  RECEIVED: "รับเข้าคลังแล้ว",
  REJECTED: "ปฏิเสธ",
};

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManageLabOrders = user?.role === "Admin" || user?.role === "Manager";
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrderSummary | null>(null);
  const [vendor, setVendor] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<PurchaseOrderItemDraft[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogReagent[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [activeReagentPicker, setActiveReagentPicker] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestionNotice, setSuggestionNotice] = useState("");

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("labstock_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/purchase-orders", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = (await res.json()) as PurchaseOrderSummary[];
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadOrders = async () => {
      try {
        const res = await fetch("/api/purchase-orders", { headers: getAuthHeaders() });
        if (res.ok) {
          const data = (await res.json()) as PurchaseOrderSummary[];
          if (active) {
            setOrders(Array.isArray(data) ? data : []);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    void loadOrders();

    return () => {
      active = false;
    };
  }, [fetchOrders]);

  useEffect(() => {
    let active = true;

    const loadOrderFormOptions = async () => {
      setCatalogLoading(true);
      try {
        const headers = getAuthHeaders();
        const [settingsResponse, catalogResponse] = await Promise.all([
          fetch("/api/settings", { headers }),
          fetch("/api/dashboard", { headers }),
        ]);

        if (!active) return;
        if (settingsResponse.ok) {
          const data = (await settingsResponse.json()) as OrderFormOptions;
          setVendors(Array.isArray(data.vendors) ? data.vendors : []);
        }
        if (catalogResponse.ok) {
          const data = (await catalogResponse.json()) as CatalogReagent[];
          setCatalog(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (active) setCatalogLoading(false);
      }
    };

    void loadOrderFormOptions();
    return () => {
      active = false;
    };
  }, []);

  const loadSuggestions = async () => {
    if (!vendor.trim()) {
      alert("กรุณาเลือกบริษัทก่อน");
      return;
    }
    setSuggestLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders/suggest?vendor=${encodeURIComponent(vendor)}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = (await res.json()) as SuggestedPurchaseOrderItem[];
        const heldForReview = data.filter((item) => !item.auto_selectable);
        const suggestedItems: PurchaseOrderItemDraft[] = data.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          quantity: item.suggested_order_qty,
          unit: item.unit,
          policy_order_qty: item.policy_order_qty,
          dynamic_order_qty: item.dynamic_order_qty,
          selected_basis: "POLICY",
          confidence: item.confidence,
          review_reasons: item.review_reasons,
          requires_review: !item.auto_selectable,
          suggestion_context: {
            daily_demand_boxes: item.calculation_breakdown.dailyDemandBoxes,
            demand_source: item.calculation_breakdown.demandSource,
            projected_balance_at_horizon: item.projected_balance_at_horizon,
            safety_stock_boxes: item.safety_stock_boxes,
            lead_time_days: item.lead_time_days,
            horizon_days: item.horizon_days,
            expiry_assessment: item.expiry_assessment,
          },
        }));
        setItems(suggestedItems);
        setSuggestionNotice(heldForReview.length
          ? `แสดงผลคำนวณแล้ว ${data.length} รายการ; มี ${heldForReview.length} รายการที่ควรตรวจทานก่อนบันทึกใบสั่งซื้อ`
          : "");
      } else {
        const error = (await res.json().catch(() => null)) as { error?: string } | null;
        setSuggestionNotice(error?.error ?? "ไม่สามารถคำนวณรายการแนะนำได้ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (error) {
      console.error(error);
      setSuggestionNotice("ไม่สามารถเชื่อมต่อระบบคำนวณรายการแนะนำได้");
    } finally {
      setSuggestLoading(false);
    }
  };

  const resetOrderForm = () => {
    setShowCreateModal(false);
    setEditingOrder(null);
    setVendor("");
    setExpectedDate("");
    setNote("");
    setItems([]);
  };

  const openEditOrder = (order: PurchaseOrderSummary) => {
    setEditingOrder(order);
    setVendor(order.vendor);
    setExpectedDate(order.expected_date ? String(order.expected_date).slice(0, 10) : "");
    setNote(order.note ?? "");
    setItems((order.items ?? []).map((item) => ({ ...item })));
    setShowCreateModal(true);
  };

  const handleSave = async () => {
    const missingOverrideReason = items.find((item) => item.selected_basis === "MANUAL" && !item.override_reason?.trim());
    if (missingOverrideReason) {
      alert(`กรุณาระบุเหตุผลที่แก้จำนวนของ ${missingOverrideReason.item_name || missingOverrideReason.item_id}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(editingOrder ? `/api/purchase-orders/${editingOrder.id}` : "/api/purchase-orders", {
        method: editingOrder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(editingOrder ? {
          action: "UPDATE_UNACKNOWLEDGED_LAB_ORDER",
          expected_date: expectedDate || null,
          note,
          items,
        } : {
          vendor,
          expected_date: expectedDate,
          note,
          items,
        }),
      });

      if (res.ok) {
        resetOrderForm();
        await fetchOrders();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? (editingOrder ? "ไม่สามารถแก้ไขใบสั่งน้ำยาได้" : "ไม่สามารถสร้างใบสั่งน้ำยาได้"));
      }
    } catch (e) {
      console.error(e);
      alert(editingOrder ? "เกิดข้อผิดพลาดขณะแก้ไขใบสั่งน้ำยา" : "เกิดข้อผิดพลาดขณะสร้างใบสั่งน้ำยา");
    } finally {
      setLoading(false);
    }
  };

  const addItemRow = () => {
    setItems((current) => [...current, { item_id: "", item_name: "", quantity: 1, unit: "box", selected_basis: "MANUAL" }]);
  };

  const changeVendor = (nextVendor: string) => {
    setVendor(nextVendor);
    setItems([]);
    setSuggestionNotice("");
  };

  const updateItemName = (index: number, itemName: string) => {
    setItems((current) => {
      const next = [...current];
      next[index] = { ...next[index], item_name: itemName, item_id: "" };
      return next;
    });
  };

  const selectReagent = (index: number, reagent: CatalogReagent) => {
    setItems((current) => {
      const next = [...current];
      next[index] = {
        ...next[index],
        item_id: reagent.itemId,
        item_name: reagent.name,
        unit: reagent.unit,
        selected_basis: "MANUAL",
      };
      return next;
    });
    setActiveReagentPicker(null);
  };

  const groupedReagentsByItem = useMemo(() => items.map((item) => {
    const searchTerm = item.item_name.trim().toLocaleLowerCase();
    const matchingReagents = catalog
      .filter((reagent) => reagent.vendor === vendor)
      .filter((reagent) => {
        if (!searchTerm) return true;
        return reagent.name.toLocaleLowerCase().includes(searchTerm)
          || reagent.itemId.toLocaleLowerCase().includes(searchTerm);
      })
      .sort((left, right) => left.name.localeCompare(right.name, "th"));

    return Object.entries(matchingReagents.reduce<Record<string, CatalogReagent[]>>((groups, reagent) => {
      const category = reagent.reagentType?.trim() || "ไม่ระบุประเภท";
      (groups[category] ??= []).push(reagent);
      return groups;
    }, {})).sort(([left], [right]) => left.localeCompare(right, "th"));
  }), [catalog, items, vendor]);

  const catalogByItemId = useMemo(
    () => new Map(catalog.map((reagent) => [reagent.itemId, reagent])),
    [catalog]
  );

  const updateItem = (
    index: number,
    field: keyof PurchaseOrderItemDraft,
    value: PurchaseOrderItemDraft[keyof PurchaseOrderItemDraft]
  ) => {
    setItems((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const updateQuantity = (index: number, quantity: number) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, quantity, selected_basis: "MANUAL" }
      : item));
  };

  const chooseQuantityBasis = (index: number, basis: "POLICY" | "DYNAMIC") => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const quantity = basis === "POLICY" ? item.policy_order_qty : item.dynamic_order_qty;
      return { ...item, quantity: Number(quantity ?? item.quantity), selected_basis: basis, override_reason: "" };
    }));
  };

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const reviewOrder = async (id: number, status: "CONFIRMED" | "REJECTED") => {
    const action = status === "CONFIRMED" ? "ยืนยันรายการ" : "ปฏิเสธรายการ";
    if (!confirm(`ต้องการ${action}นี้หรือไม่?`)) return;

    const res = await fetch(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "อัปเดตรายการไม่สำเร็จ");
      return;
    }
    await fetchOrders();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">ใบสั่งน้ำยา</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/orders/tracking")}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            🚚 ติดตามพัสดุ
          </button>
          <button
            onClick={() => {
              resetOrderForm();
              setShowCreateModal(true);
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            + สร้างใบสั่งน้ำยา
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">เลขที่ใบสั่งน้ำยา</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">บริษัท</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">สถานะ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">รายการ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">วันที่สร้าง</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ดำเนินการ</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {orders.map((po) => (
              <tr key={po.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium">{po.po_number}</td>
                <td className="px-6 py-4">{po.vendor}</td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded text-xs font-bold ${
                      po.status === "PENDING_MANAGER_REVIEW" || po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED"
                        ? "bg-orange-100 text-orange-800"
                        : po.status === "SUBMITTED"
                        ? "bg-yellow-100 text-yellow-800"
                        : po.status === "CONFIRMED"
                          ? "bg-blue-100 text-blue-800"
                          : po.status === "SHIPPED"
                            ? "bg-purple-100 text-purple-800"
                            : po.status === "RECEIVED"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {statusLabels[po.status] ?? po.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{po.items?.length || 0} รายการ</td>
                <td className="px-6 py-4 text-sm text-gray-500">{new Date(po.created_at).toLocaleDateString("th-TH")}</td>
                <td className="px-6 py-4 text-sm font-medium">
                  {po.status === "PENDING_MANAGER_REVIEW" && canManageLabOrders && (
                    <div className="mb-2">
                      <button onClick={() => router.push(`/orders/${po.id}`)} className="text-teal-700 hover:text-teal-900">ตรวจสอบก่อนส่งบริษัท</button>
                    </div>
                  )}
                  {canManageLabOrders && (po.status === "PENDING_MANAGER_REVIEW" || po.status === "SUBMITTED") && po.proposal_origin === "LAB" && (
                    <div className="mb-2">
                      <button onClick={() => openEditOrder(po)} className="text-amber-700 hover:text-amber-900">แก้ไขก่อนบริษัทรับทราบ</button>
                    </div>
                  )}
                  {canManageLabOrders && (po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED") && (
                    <div className="mb-2 flex gap-2">
                      <button onClick={() => reviewOrder(po.id, "CONFIRMED")} className="text-green-700 hover:text-green-900">ยืนยัน</button>
                      <button onClick={() => reviewOrder(po.id, "REJECTED")} className="text-red-600 hover:text-red-800">ปฏิเสธ</button>
                    </div>
                  )}
                  <button
                    onClick={() => router.push(`/orders/${po.id}`)}
                    className="text-indigo-600 hover:text-indigo-900"
                  >
                    ดูรายละเอียด
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">{editingOrder ? `แก้ไขใบสั่งน้ำยา ${editingOrder.po_number}` : "สร้างใบสั่งน้ำยา"}</h2>
              <button onClick={resetOrderForm} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2">
              <div>
                <label htmlFor="order-vendor" className="block text-sm font-medium text-gray-700 mb-1">บริษัท*</label>
                <select
                  id="order-vendor"
                  value={vendor}
                  onChange={(e) => changeVendor(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white p-2 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
                  disabled={catalogLoading || !!editingOrder}
                >
                  <option value="">{catalogLoading ? "กำลังโหลดรายชื่อบริษัท..." : "เลือกบริษัท"}</option>
                  {vendors.map((company) => <option key={company} value={company}>{company}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  วันที่คาดว่าจะส่ง
                </label>
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="w-full border rounded p-2"
                />
              </div>
            </div>

            <div className="mb-4 flex justify-between items-center">
              <h3 className="font-bold">รายการน้ำยา</h3>
              <div className="flex gap-2">
                {!editingOrder && (
                  <button
                    onClick={loadSuggestions}
                    disabled={suggestLoading}
                    className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm hover:bg-yellow-200"
                  >
                    {suggestLoading ? "กำลังประมวลผล..." : "แนะนำอัตโนมัติ (รอบ 15 วัน)"}
                  </button>
                )}
                {!editingOrder && (
                  <button
                    onClick={addItemRow}
                    className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200"
                  >
                    + เพิ่มแถว
                  </button>
                )}
              </div>
            </div>

            {suggestionNotice && (
              <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {suggestionNotice}
              </div>
            )}

            {items.map((item, index) => (
              <div key={index} className="flex gap-2 mb-2 items-start">
                <div className="relative flex-1">
                  <input
                    role="combobox"
                    aria-label={`ชื่อน้ำยา รายการที่ ${index + 1}`}
                    aria-autocomplete="list"
                    aria-expanded={activeReagentPicker === index}
                    aria-controls={`reagent-picker-${index}`}
                    placeholder={vendor ? "พิมพ์หรือเลือกชื่อน้ำยา" : "เลือกบริษัทก่อน"}
                    value={item.item_name}
                    onFocus={() => setActiveReagentPicker(index)}
                    onChange={(event) => {
                      updateItemName(index, event.target.value);
                      setActiveReagentPicker(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setActiveReagentPicker(null);
                    }}
                    className="w-full rounded border border-gray-300 p-2 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
                    disabled={!vendor}
                  />
                  {activeReagentPicker === index && vendor && (
                    <div id={`reagent-picker-${index}`} role="listbox" aria-label="รายการน้ำยาตามประเภท" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                      {groupedReagentsByItem[index].length > 0 ? groupedReagentsByItem[index].map(([category, reagents]) => (
                        <div key={category} className="py-1">
                          <p className="sticky top-0 border-y border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800">ประเภท: {category}</p>
                          {reagents.map((reagent) => (
                            <button
                              key={reagent.itemId}
                              type="button"
                              role="option"
                              aria-selected={item.item_id === reagent.itemId}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectReagent(index, reagent)}
                              className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                            >
                              <span className="block text-sm font-medium text-gray-900">{reagent.name}</span>
                              <span className="block text-xs text-gray-500">{reagent.jobType || "ไม่ระบุงาน"} · {reagent.itemId} · {reagent.unit}</span>
                              <span className={`mt-1 block text-xs font-semibold ${reagent.quantity <= reagent.minThreshold ? "text-amber-700" : "text-teal-700"}`}>
                                คงเหลือ {reagent.quantity} {reagent.unit} · ขั้นต่ำ {reagent.minThreshold}
                              </span>
                            </button>
                          ))}
                        </div>
                      )) : (
                        <p className="px-3 py-4 text-center text-sm text-gray-500">ไม่พบรายการน้ำยาที่ตรงกับคำค้นหา</p>
                      )}
                    </div>
                  )}
                  {catalogByItemId.get(item.item_id) && (
                    <p className={`mt-1 text-xs font-semibold ${catalogByItemId.get(item.item_id)!.quantity <= catalogByItemId.get(item.item_id)!.minThreshold ? "text-amber-700" : "text-teal-700"}`}>
                      คงเหลือ {catalogByItemId.get(item.item_id)!.quantity} {catalogByItemId.get(item.item_id)!.unit}
                      {catalogByItemId.get(item.item_id)!.quantity <= catalogByItemId.get(item.item_id)!.minThreshold
                        ? ` · ต่ำกว่าหรือเท่ากับขั้นต่ำ ${catalogByItemId.get(item.item_id)!.minThreshold}`
                        : ` · ขั้นต่ำ ${catalogByItemId.get(item.item_id)!.minThreshold}`}
                    </p>
                  )}
                  {item.policy_order_qty !== undefined && (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => chooseQuantityBasis(index, "POLICY")} className={`rounded-md border px-2 py-2 text-left ${item.selected_basis === "POLICY" ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 bg-white"}`}>
                          <span className="block text-[10px] font-semibold text-slate-500">ค่าที่แล็บอนุมัติ</span>
                          <span className="font-bold">{item.policy_order_qty} {item.unit}</span>
                        </button>
                        <button type="button" onClick={() => chooseQuantityBasis(index, "DYNAMIC")} disabled={!item.dynamic_order_qty} className={`rounded-md border px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${item.selected_basis === "DYNAMIC" ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white"}`}>
                          <span className="block text-[10px] font-semibold text-slate-500">ค่าคำนวณสด</span>
                          <span className="font-bold">{item.dynamic_order_qty} {item.unit}</span>
                        </button>
                      </div>
                      <p className="mt-2 text-slate-600">ความเชื่อมั่น: {item.confidence === "high" ? "สูง" : item.confidence === "low" ? "ต่ำ" : "ยังไม่มีข้อมูล"}</p>
                      {item.suggestion_context && (
                        <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 p-2 text-teal-950">
                          <p className="font-bold">เหตุผลที่ระบบแนะนำ</p>
                          <p>คำนวณตามรอบสั่ง {item.suggestion_context.horizon_days} วัน; ระยะรอของ {item.suggestion_context.lead_time_days} วัน แล้วคาดว่าเหลือ {item.suggestion_context.projected_balance_at_horizon} {item.unit}; Safety stock {item.suggestion_context.safety_stock_boxes} {item.unit}</p>
                          <p>ใช้อัตรา {item.suggestion_context.daily_demand_boxes} {item.unit}/วัน จาก{demandSourceLabels[item.suggestion_context.demand_source]}</p>
                          {item.suggestion_context.expiry_assessment.expired_qty_excluded > 0 && <p className="mt-1 font-semibold text-amber-800">ไม่นับสต็อกหมดอายุแล้ว {item.suggestion_context.expiry_assessment.expired_qty_excluded} {item.unit}</p>}
                          {item.suggestion_context.expiry_assessment.expiring_within_horizon_qty > 0 && <p className="mt-1 font-semibold text-amber-800">ประเมิน FEFO: มี {item.suggestion_context.expiry_assessment.expiring_within_horizon_qty} {item.unit} ที่หมดอายุภายในช่วงคำนวณ{item.suggestion_context.expiry_assessment.nearest_expiry_date ? ` (ใกล้สุด ${formatExpiryDate(item.suggestion_context.expiry_assessment.nearest_expiry_date)})` : ""}</p>}
                        </div>
                      )}
                      {!!item.review_reasons?.length && <p className="mt-1 font-semibold text-amber-800">ทบทวนจำนวน: {item.review_reasons.join(", ")}</p>}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  placeholder="จำนวน"
                  value={item.quantity}
                  onChange={(e) => updateQuantity(index, Number.parseInt(e.target.value, 10) || 0)}
                  className="border rounded p-2 w-24"
                />
                <input
                  aria-label={`หน่วยของ ${item.item_name || `รายการที่ ${index + 1}`}`}
                  placeholder="หน่วย"
                  value={item.unit}
                  onChange={(e) => updateItem(index, "unit", e.target.value)}
                  className="border rounded p-2 w-24"
                />
                {!editingOrder && (
                  <button onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700 p-2">
                    ✕
                  </button>
                )}
                {item.selected_basis === "MANUAL" && (
                  <input
                    aria-label={`เหตุผลที่แก้จำนวน ${item.item_name || index + 1}`}
                    placeholder="เหตุผลที่แก้จำนวน*"
                    value={item.override_reason ?? ""}
                    onChange={(event) => updateItem(index, "override_reason", event.target.value)}
                    className="w-48 rounded border border-amber-300 bg-amber-50 p-2 text-sm"
                    required
                  />
                )}
              </div>
            ))}

            {items.length === 0 && (
              <div className="text-center py-8 text-gray-500 bg-gray-50 rounded border border-dashed">
                ยังไม่มีรายการน้ำยา กดปุ่ม + เพิ่มแถว หรือ
                แนะนำอัตโนมัติ
              </div>
            )}

            <div className="mt-6 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุเพิ่มเติม</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border rounded p-2"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6 border-t pt-4">
              <button
                onClick={resetOrderForm}
                className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                disabled={loading || items.length === 0 || !vendor || items.some((item) => !item.item_id)}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? "กำลังบันทึก..." : editingOrder ? "บันทึกการแก้ไข" : "บันทึกและส่งใบสั่งน้ำยาให้บริษัท"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
