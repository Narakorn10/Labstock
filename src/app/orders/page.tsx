"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PurchaseOrderStatus = "PENDING_LAB_REVIEW" | "SUBMITTED" | "ACKNOWLEDGED" | "REVISION_REQUESTED" | "CONFIRMED" | "PARTIALLY_SHIPPED" | "SHIPPED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "REJECTED";

interface PurchaseOrderItemDraft {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
}

interface PurchaseOrderSummary {
  id: number;
  po_number: string;
  vendor: string;
  status: PurchaseOrderStatus;
  proposal_origin?: "LAB" | "VENDOR";
  created_at: string;
  items?: PurchaseOrderItemDraft[];
}

interface SuggestedPurchaseOrderItem {
  item_id: string;
  name: string;
  suggested_order_qty: number;
  unit: string;
  vendor?: string;
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
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
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
        const suggestedItems: PurchaseOrderItemDraft[] = data.map((item) => ({
          item_id: item.item_id,
          item_name: item.name,
          quantity: item.suggested_order_qty,
          unit: item.unit,
        }));
        setItems(suggestedItems);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          vendor,
          expected_date: expectedDate,
          note,
          items,
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setVendor("");
        setExpectedDate("");
        setNote("");
        setItems([]);
        await fetchOrders();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "ไม่สามารถสร้างใบสั่งน้ำยาได้");
      }
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาดขณะสร้างใบสั่งน้ำยา");
    } finally {
      setLoading(false);
    }
  };

  const addItemRow = () => {
    setItems((current) => [...current, { item_id: "", item_name: "", quantity: 1, unit: "box" }]);
  };

  const changeVendor = (nextVendor: string) => {
    setVendor(nextVendor);
    setItems([]);
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
            onClick={() => setShowCreateModal(true)}
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
                      po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED"
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
                  {(po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED") && (
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
              <h2 className="text-xl font-bold">สร้างใบสั่งน้ำยา</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">
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
                  disabled={catalogLoading}
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
                <button
                  onClick={loadSuggestions}
                  disabled={suggestLoading}
                  className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm hover:bg-yellow-200"
                >
                  {suggestLoading ? "กำลังประมวลผล..." : "🤖 แนะนำอัตโนมัติ (จากจุดสั่งซื้อ)"}
                </button>
                <button
                  onClick={addItemRow}
                  className="px-3 py-1 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200"
                >
                  + เพิ่มแถว
                </button>
              </div>
            </div>

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
                </div>
                <input
                  type="number"
                  placeholder="จำนวน"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value, 10) || 0)}
                  className="border rounded p-2 w-24"
                />
                <input
                  aria-label={`หน่วยของ ${item.item_name || `รายการที่ ${index + 1}`}`}
                  placeholder="หน่วย"
                  value={item.unit}
                  onChange={(e) => updateItem(index, "unit", e.target.value)}
                  className="border rounded p-2 w-24"
                />
                <button onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700 p-2">
                  ✕
                </button>
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
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || items.length === 0 || !vendor || items.some((item) => !item.item_id)}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? "กำลังบันทึก..." : "บันทึกและส่งใบสั่งน้ำยาให้บริษัท"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
