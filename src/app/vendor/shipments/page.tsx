"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, type ShipmentItem } from "@/lib/api-client";
import { CheckCircle2, FileText, FileUp, Loader2, Plus, Trash2, Truck, AlertTriangle } from "lucide-react";

type OrderItem = { itemId: string; itemName: string; unit: string; orderedQty: number; remainingQty: number };
type Order = { po_number: string; expected_date?: string; items: OrderItem[] };
type OcrResult = { items: ShipmentItem[] };
type ShipmentLine = ShipmentItem & { poLine?: boolean };
type ShipmentHistory = { id: number; po_number?: string; reagent_name?: string; quantity: number; accepted_qty?: number; rejected_qty?: number; status: string; rejection_reason?: string; created_at?: string };

const blankRow = (): ShipmentLine => ({ itemId: "", lotNo: "", expDate: "", qty: 0, confidence: "red", mappingReason: "Manual entry" });

export default function VendorShipmentsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<ShipmentHistory[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [items, setItems] = useState<ShipmentLine[]>([blankRow()]);
  const [referenceNo, setReferenceNo] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<{ type: "MANUAL" | "PDF_TEXT" | "AZURE_OCR"; fileName?: string; fileHash?: string }>({ type: "MANUAL" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedOrder = orders.find((order) => order.po_number === poNumber);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("labstock_token");
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  };

  const load = useCallback(async () => {
    try {
      const [orderRows, shipmentRows] = await Promise.all([
        fetch("/api/vendor/shipments/orders", { headers: authHeaders() }),
        apiClient.getShipments(),
      ]);
      if (orderRows.ok) setOrders(await orderRows.json() as Order[]);
      if (Array.isArray(shipmentRows)) setHistory(shipmentRows as ShipmentHistory[]);
      else setNotice("Could not load previous shipments.");
    } catch {
      setNotice("Could not load shipment data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const updateItem = (index: number, patch: Partial<ShipmentLine>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch, confidence: "amber", mappingReason: "Reviewed by vendor" } : item));
  };

  const readOcr = async (payload: { text?: string; base64Source?: string }) => {
    const response = await fetch("/api/vendor/shipments/ocr", { method: "POST", headers: authHeaders(), body: JSON.stringify({ poNumber, ...payload }) });
    const data = await response.json() as OcrResult & { error?: string };
    if (!response.ok) throw new Error(data.error || "OCR failed");
    return data.items;
  };

  const handlePdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!poNumber) { setNotice("Select the confirmed purchase order before uploading a PDF."); return; }
    if (file.type !== "application/pdf") { setNotice("Only PDF delivery documents are supported."); return; }
    setProcessingPdf(true); setNotice("");
    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const fileHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
      let text = "";
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        const content = await (await pdf.getPage(pageNo)).getTextContent();
        text += `${content.items.map((item) => "str" in item ? item.str : "").join(" ")}\n`;
      }
      let mapped: ShipmentItem[] = [];
      let sourceType: "PDF_TEXT" | "AZURE_OCR" = "PDF_TEXT";
      if (text.replace(/\s/g, "").length >= 30) {
        mapped = await readOcr({ text });
      } else {
        sourceType = "AZURE_OCR";
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
          const page = await pdf.getPage(pageNo);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not prepare PDF page for OCR");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const base64Source = canvas.toDataURL("image/jpeg", 0.78).split(",")[1];
          if (Math.ceil(base64Source.length * 0.75) > 3_500_000) throw new Error(`Page ${pageNo} is too large for OCR; enter it manually.`);
          mapped = mapped.concat(await readOcr({ base64Source }));
        }
      }
      setItems(mapped.length ? mapped : [blankRow()]);
      setSource({ type: sourceType, fileName: file.name, fileHash });
      setNotice(mapped.length ? "PDF mapped. Review every amber or red row before submitting." : "No confident rows found. Complete the form manually.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not read the PDF. Enter shipment manually.");
    } finally {
      setProcessingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!selectedOrder) { setNotice("Select a confirmed purchase order."); return; }
    if (!referenceNo.trim()) { setNotice("Delivery reference is required."); return; }
    const suppliedItems = items.filter((item) => item.qty > 0);
    if (!suppliedItems.length) { setNotice("Enter the quantity that can be supplied for at least one PO item."); return; }
    setSubmitting(true); setNotice("");
    try {
      const result = await apiClient.uploadShipments(suppliedItems, referenceNo, poNumber, trackingNo, "Manual", {
        sourceType: source.type, sourceFileName: source.fileName ?? "", sourceFileHash: source.fileHash ?? "",
        clientRequestId: crypto.randomUUID(),
      });
      if (!result.success) throw new Error(result.error || "Unable to submit shipment");
      setNotice("Shipment submitted and is waiting for Lab receipt.");
      setItems([blankRow()]); setReferenceNo(""); setTrackingNo(""); setSource({ type: "MANUAL" });
      await load();
    } catch (error: unknown) {
      // Show the API's reason (e.g. short shelf life, quantity exceeded), not the generic HTTP error.
      const apiError = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      setNotice(apiError || (error instanceof Error ? error.message : "Unable to submit shipment"));
    } finally { setSubmitting(false); }
  };

  const selectPurchaseOrder = (nextPoNumber: string) => {
    setPoNumber(nextPoNumber);
    const order = orders.find((candidate) => candidate.po_number === nextPoNumber);
    setItems(order
      ? order.items.filter((item) => item.remainingQty > 0).map((item) => ({
          itemId: item.itemId, lotNo: "", expDate: "", qty: 0, confidence: "amber", mappingReason: "PO line entered by vendor", poLine: true,
        }))
      : [blankRow()]);
    setSource({ type: "MANUAL" });
    setNotice("");
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return <div className="max-w-6xl mx-auto space-y-6 pb-24">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-black text-gray-900">แจ้งส่งสินค้า</h1><p className="text-sm text-gray-500 mt-1">เลือก PO ที่ยืนยันแล้ว เพิ่ม lot ได้หลายรายการ และตรวจทานก่อนส่งเข้าระบบ</p></div><Truck className="text-blue-600" size={36} /></div>
    {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2"><AlertTriangle size={18} />{notice}</div>}
    <section className="bg-white border rounded-2xl p-6 space-y-4 shadow-sm">
      <div className="grid md:grid-cols-3 gap-4"><label className="text-sm font-bold">Confirmed PO<select value={poNumber} onChange={(event) => selectPurchaseOrder(event.target.value)} className="mt-1 w-full border rounded-lg p-2"><option value="">Select PO</option>{orders.map((order) => <option key={order.po_number} value={order.po_number}>{order.po_number}</option>)}</select></label><label className="text-sm font-bold">Delivery reference<input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} className="mt-1 w-full border rounded-lg p-2" placeholder="Delivery note / invoice" /></label><label className="text-sm font-bold">Tracking no. (optional)<input value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} className="mt-1 w-full border rounded-lg p-2" /></label></div>
      {selectedOrder && <div className="text-sm rounded-lg border border-blue-100 bg-blue-50 p-3 text-blue-950">รายการจาก PO ถูกนำมาใส่ในตารางด้านล่างแล้ว กรุณากรอกเฉพาะจำนวนที่บริษัทจัดส่งได้ พร้อม Lot และวันหมดอายุ</div>}
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdf} />
      <button disabled={!poNumber || processingPdf} onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-50">{processingPdf ? <Loader2 size={17} className="animate-spin" /> : <FileUp size={17} />}Read delivery PDF (review required)</button>
      <p className="text-xs text-gray-500"><FileText className="inline mr-1" size={14} />PDF/text is not retained. Scanned pages use Azure only when text extraction fails.</p>
    </section>
    <section className="bg-white border rounded-2xl overflow-hidden shadow-sm"><div className="p-5 flex justify-between items-center border-b"><div><h2 className="font-black">รายการจัดส่งตาม PO</h2><p className="mt-1 text-xs text-slate-500">Lab สั่งและคงเหลือเป็นข้อมูลอ้างอิง บริษัทกรอกจำนวนที่จัดส่งได้, Lot และวันหมดอายุ</p></div><button disabled={!selectedOrder} onClick={() => setItems((current) => [...current, blankRow()])} className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 disabled:opacity-40"><Plus size={16} />เพิ่ม Lot เดิม</button></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">น้ำยาที่ Lab สั่ง</th><th className="p-3 text-right">Lab สั่ง</th><th className="p-3 text-right">คงเหลือให้จัดส่ง</th><th className="p-3">จำนวนที่จัดส่งได้</th><th className="p-3">Lot</th><th className="p-3">วันหมดอายุ</th><th /></tr></thead><tbody>{items.map((item, index) => { const orderItem = selectedOrder?.items.find((option) => option.itemId === item.itemId); return <tr key={index} className="border-t align-top"><td className="p-3">{item.poLine && orderItem ? <><p className="font-semibold text-slate-900">{orderItem.itemName}</p><p className="text-xs text-slate-500">{orderItem.itemId}</p></> : <select value={item.itemId} onChange={(event) => updateItem(index, { itemId: event.target.value })} className="border rounded p-2 min-w-48"><option value="">เลือกรายการเดิม</option>{selectedOrder?.items.filter((option) => option.remainingQty > 0).map((option) => <option key={option.itemId} value={option.itemId}>{option.itemName}</option>)}</select>}</td><td className="p-3 text-right text-slate-700">{orderItem ? `${orderItem.orderedQty} ${orderItem.unit}` : "-"}</td><td className="p-3 text-right font-semibold text-slate-900">{orderItem ? `${orderItem.remainingQty} ${orderItem.unit}` : "-"}</td><td className="p-3"><input aria-label="จำนวนที่จัดส่งได้" type="number" min="0" step="0.01" value={item.qty || ""} onChange={(event) => updateItem(index, { qty: Number(event.target.value) })} className="border rounded p-2 w-28" placeholder="0" /></td><td className="p-3"><input aria-label="Lot" value={item.lotNo} onChange={(event) => updateItem(index, { lotNo: event.target.value })} className="border rounded p-2 w-36" /></td><td className="p-3"><input aria-label="วันหมดอายุ" type="date" value={item.expDate} onChange={(event) => updateItem(index, { expDate: event.target.value })} className="border rounded p-2" /></td><td className="p-3">{!item.poLine && <button aria-label="Remove lot" onClick={() => setItems((current) => current.length === 1 ? [blankRow()] : current.filter((_, rowIndex) => rowIndex !== index))} className="text-gray-400 hover:text-red-600"><Trash2 size={17} /></button>}</td></tr>; })}</tbody></table></div></section>
    <button disabled={submitting || !poNumber} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-black text-white disabled:bg-blue-300">{submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}Submit reviewed shipment</button>
    <section className="bg-white border rounded-2xl overflow-hidden shadow-sm"><div className="p-5 border-b"><h2 className="font-black">ประวัติการจัดส่ง</h2><p className="text-xs text-slate-500 mt-1">ของที่ถูกปฏิเสธจะไม่ปิดยอด PO และต้องส่งทดแทน</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">PO</th><th className="p-3">น้ำยา</th><th className="p-3 text-right">ส่ง</th><th className="p-3 text-right">รับผ่าน</th><th className="p-3 text-right">ไม่ผ่าน</th><th className="p-3">สถานะ</th><th className="p-3">หมายเหตุ</th></tr></thead><tbody>{history.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.po_number || "-"}</td><td className="p-3">{row.reagent_name || "-"}</td><td className="p-3 text-right">{row.quantity}</td><td className="p-3 text-right text-emerald-700">{row.accepted_qty ?? "-"}</td><td className="p-3 text-right text-red-700">{row.rejected_qty ?? "-"}</td><td className="p-3">{row.status}</td><td className="p-3 text-red-700">{row.rejection_reason || "-"}</td></tr>)}{history.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">ยังไม่มีประวัติ</td></tr>}</tbody></table></div></section>
  </div>;
}
