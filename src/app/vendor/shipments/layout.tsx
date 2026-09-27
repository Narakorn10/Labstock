import type { ReactNode } from "react";
import { ShipmentsGate } from "@/components/shipments-disabled-notice";

export default function VendorShipmentsLayout({ children }: { children: ReactNode }) {
  return <ShipmentsGate>{children}</ShipmentsGate>;
}
