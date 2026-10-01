"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, type ShipmentItem } from "@/lib/api-client";
import { CheckCircle2, FileText, FileUp, Loader2, Plus, Trash2, AlertTriangle } from "lucide-react";

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

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-gray-600" /></div>;

  const fieldClass = "min-h-[38px] w-full min-w-0 rounded-[10px] border border-line bg-white px-3 py-[7px] text-sm text-ink outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-400/10";
  const labelClass = "flex flex-col gap-1.5 text-[13px] text-gray-600";
  const headClass = "bg-ground px-3.5 py-2.5 text-left text-[13px] font-medium text-gray-600";
  const cellClass = "border-b border-line px-3.5 py-3 align-middle text-sm";
  const btnClass = "inline-flex items-center gap-2 rounded-[10px] border border-line bg-white px-4 py-[9px] text-sm font-medium text-ink transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

  return <div className="space-y-6 pb-24">
    <div>
      <h1 className="text-[32px] leading-tight font-medium text-ink">แจ้งส่งสินค้า</h1>
      <p className="mt-1.5 text-[15px] text-gray-600">เลือก PO ที่ยืนยันแล้ว เพิ่ม lot ได้หลายรายการ และตรวจทานก่อนส่งเข้าระบบ</p>
    </div>

    {notice && <div role="status" className="flex items-center gap-2.5 rounded-xl bg-warn-bg px-3.5 py-3 text-sm font-medium text-warn"><AlertTriangle size={18} className="shrink-0" /><span>{notice}</span></div>}

    <section aria-labelledby="shipment-po-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="shipment-po-heading" className="mb-1 text-lg font-medium">รายการจัดส่งตาม PO</h2>
      <p className="mb-3.5 text-[13px] text-gray-600">Lab สั่งและคงเหลือเป็นข้อมูลอ้างอิง บริษัทกรอกจำนวนที่จัดส่งได้, Lot และวันหมดอายุ</p>

      <div className="grid gap-3 md:grid-cols-3">
        <label className={labelClass}>Confirmed PO
          <select value={poNumber} onChange={(event) => selectPurchaseOrder(event.target.value)} className={`${fieldClass} cursor-pointer`}>
            <option value="">Select PO</option>
            {orders.map((order) => <option key={order.po_number} value={order.po_number}>{order.po_number}</option>)}
          </select>
        </label>
        <label className={labelClass}>Delivery reference
          <input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} className={fieldClass} placeholder="Delivery note / invoice" />
        </label>
        <label className={labelClass}>Tracking no. (optional)
          <input value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} className={fieldClass} />
        </label>
      </div>

      {selectedOrder && <p className="mt-3 rounded-xl bg-[#fafafa] px-3.5 py-3 text-[13px] text-gray-700">รายการจาก PO ถูกนำมาใส่ในตารางด้านล่างแล้ว กรุณากรอกเฉพาะจำนวนที่บริษัทจัดส่งได้ พร้อม Lot และวันหมดอายุ</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdf} />
        <button type="button" disabled={!poNumber || processingPdf} onClick={() => fileInputRef.current?.click()} className={btnClass}>
          {processingPdf ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}Read delivery PDF (review required)
        </button>
        <p className="text-xs text-gray-600"><FileText className="mr-1 inline" size={14} />PDF/text is not retained. Scanned pages use Azure only when text extraction fails.</p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <caption className="sr-only">รายการจัดส่งตาม PO</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} rounded-l-[10px]`}>น้ำยาที่ Lab สั่ง</th>
              <th scope="col" className={`${headClass} text-right`}>Lab สั่ง</th>
              <th scope="col" className={`${headClass} text-right`}>คงเหลือให้จัดส่ง</th>
              <th scope="col" className={`${headClass} w-[130px]`}>จำนวนที่จัดส่งได้</th>
              <th scope="col" className={`${headClass} w-[150px]`}>Lot</th>
              <th scope="col" className={`${headClass} w-[170px]`}>วันหมดอายุ</th>
              <th scope="col" className={`${headClass} w-11 rounded-r-[10px]`}><span className="sr-only">ลบ</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const orderItem = selectedOrder?.items.find((option) => option.itemId === item.itemId);
              return <tr key={index}>
                <td className={cellClass}>
                  {item.poLine && orderItem
                    ? <><p className="font-medium">{orderItem.itemName}</p><p className="text-xs text-gray-600">{orderItem.itemId}</p></>
                    : <select aria-label="เลือกรายการเดิม" value={item.itemId} onChange={(event) => updateItem(index, { itemId: event.target.value })} className={`${fieldClass} min-w-48 cursor-pointer`}>
                        <option value="">เลือกรายการเดิม</option>
                        {selectedOrder?.items.filter((option) => option.remainingQty > 0).map((option) => <option key={option.itemId} value={option.itemId}>{option.itemName}</option>)}
                      </select>}
                </td>
                <td className={`${cellClass} text-right`}>{orderItem ? `${orderItem.orderedQty} ${orderItem.unit}` : "-"}</td>
                <td className={`${cellClass} text-right font-semibold`}>{orderItem ? `${orderItem.remainingQty} ${orderItem.unit}` : "-"}</td>
                <td className={cellClass}><input aria-label="จำนวนที่จัดส่งได้" type="number" min="0" step="0.01" value={item.qty || ""} onChange={(event) => updateItem(index, { qty: Number(event.target.value) })} className={fieldClass} placeholder="0" /></td>
                <td className={cellClass}><input aria-label="Lot" value={item.lotNo} onChange={(event) => updateItem(index, { lotNo: event.target.value })} className={fieldClass} placeholder="Lot" /></td>
                <td className={cellClass}><input aria-label="วันหมดอายุ" type="date" value={item.expDate} onChange={(event) => updateItem(index, { expDate: event.target.value })} className={fieldClass} /></td>
                <td className={cellClass}>{!item.poLine && <button type="button" aria-label="Remove lot" onClick={() => setItems((current) => current.length === 1 ? [blankRow()] : current.filter((_, rowIndex) => rowIndex !== index))} className="inline-flex rounded-[10px] px-2 py-1.5 text-gray-700 hover:bg-crit-bg hover:text-crit"><Trash2 size={16} /></button>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {!selectedOrder && <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-7 text-sm text-gray-600">เลือก PO ที่ยืนยันแล้วเพื่อเริ่มกรอกรายการจัดส่ง ยืนยันใบสั่งได้ที่หน้า Vendor Orders</div>}

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={!selectedOrder} onClick={() => setItems((current) => [...current, blankRow()])} className={btnClass}><Plus size={16} />เพิ่ม Lot เดิม</button>
        <button type="button" disabled={submitting || !poNumber} onClick={submit} className="inline-flex items-center gap-2 rounded-[10px] border border-ink bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-black active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}Submit reviewed shipment
        </button>
      </div>
    </section>

    <section aria-labelledby="shipment-history-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="shipment-history-heading" className="text-lg font-medium">ประวัติการจัดส่ง</h2>
      <p className="mb-3 text-[13px] text-gray-600">ของที่ถูกปฏิเสธจะไม่ปิดยอด PO และต้องส่งทดแทน</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
          <caption className="sr-only">ประวัติการจัดส่ง</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} rounded-l-[10px]`}>PO</th>
              <th scope="col" className={headClass}>น้ำยา</th>
              <th scope="col" className={`${headClass} text-right`}>ส่ง</th>
              <th scope="col" className={`${headClass} text-right`}>รับผ่าน</th>
              <th scope="col" className={`${headClass} text-right`}>ไม่ผ่าน</th>
              <th scope="col" className={headClass}>สถานะ</th>
              <th scope="col" className={`${headClass} rounded-r-[10px]`}>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => <tr key={row.id}>
              <td className={`${cellClass} font-medium`}>{row.po_number || "-"}</td>
              <td className={cellClass}>{row.reagent_name || "-"}</td>
              <td className={`${cellClass} text-right`}>{row.quantity}</td>
              <td className={`${cellClass} text-right text-ok`}>{row.accepted_qty ?? "-"}</td>
              <td className={`${cellClass} text-right text-crit`}>{row.rejected_qty ?? "-"}</td>
              <td className={cellClass}><span className="inline-flex items-center whitespace-nowrap rounded-full bg-gray-200 px-2.5 py-[3px] text-xs font-medium">{row.status}</span></td>
              <td className={`${cellClass} text-crit`}>{row.rejection_reason || "-"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {history.length === 0 && <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-line px-3.5 py-7 text-sm text-gray-600">ยังไม่มีประวัติ</div>}
    </section>
  </div>;
}
