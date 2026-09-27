import type { ReactNode } from "react";
import { SHIPMENTS_ENABLED } from "@/lib/feature-flags";

export function ShipmentsGate({ children }: { children: ReactNode }) {
  if (SHIPMENTS_ENABLED) return children;
  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-xl font-semibold text-gray-900">ระบบ Shipment ปิดใช้งานชั่วคราว</h1>
      <p className="mt-2 text-sm text-gray-500">
        ขณะนี้ Vendor ยังไม่ได้นำข้อมูลการจัดส่งเข้าระบบ กรุณารับของผ่านเมนู Receive (รับเข้า) ตามปกติ
      </p>
    </div>
  );
}
