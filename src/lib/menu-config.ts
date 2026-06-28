import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  BellRing,
  CheckCircle2,
  Database,
  HandHelping,
  History,
  LayoutDashboard,
  Package,
  PackagePlus,
  ScanLine,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";

export type MenuItem = {
  id: string;
  name: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavigationGroup = {
  title: string;
  items: MenuItem[];
};

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    title: "Overview",
    items: [
      { id: "dashboard", name: "Inventory Overview", label: "Inventory Overview", href: "/", icon: LayoutDashboard },
      { id: "analysis", name: "Analysis (วิเคราะห์)", label: "Analysis", href: "/analysis", icon: BarChart3 },
      { id: "logs", name: "Logs (ประวัติ)", label: "History Logs", href: "/logs", icon: History },
    ],
  },
  {
    title: "Operations",
    items: [
      { id: "dispense", name: "Dispense (เบิกจ่าย)", label: "Dispense", href: "/dispense", icon: HandHelping },
      { id: "receive", name: "Receive (รับเข้า)", label: "Receive Stock", href: "/receive", icon: PackagePlus },
      { id: "count", name: "Stock Count (นับ)", label: "Stock Count", href: "/count", icon: CheckCircle2 },
      { id: "borrow", name: "ระบบยืม (Borrow)", label: "Borrow System", href: "/borrow", icon: ArrowDownToLine },
      { id: "lend", name: "ระบบให้ยืม (Lend)", label: "Lend System", href: "/lend", icon: ArrowUpFromLine },
    ],
  },
  {
    title: "Lab Procurement",
    items: [
      { id: "orders", name: "Purchase Orders", label: "Purchase Orders", href: "/orders", icon: ShoppingCart },
      { id: "receive_vendor", name: "Receive from Vendor", label: "Receive from Vendor", href: "/receive/vendor", icon: Package },
    ],
  },
  {
    title: "Vendor Portal",
    items: [
      { id: "vendor_orders", name: "Vendor Orders", label: "Vendor Orders", href: "/vendor/orders", icon: ShoppingCart },
      { id: "vendor_shipments", name: "Vendor Shipments", label: "Vendor Shipments", href: "/vendor/shipments", icon: PackagePlus },
    ],
  },
  {
    title: "Management",
    items: [
      { id: "master_data", name: "Master Data", label: "Master Data", href: "/master", icon: Database },
      { id: "user_management", name: "User Management", label: "User Management", href: "/master/users", icon: Shield },
      { id: "rbac", name: "Permissions (RBAC)", label: "Permissions Management", href: "/master/permissions", icon: ShieldCheck },
    ],
  },
  {
    title: "Settings",
    items: [
      { id: "settings", name: "Settings (ตั้งค่า)", label: "System Settings", href: "/settings", icon: Settings },
      { id: "notifications", name: "Notifications", label: "Notifications", href: "/settings/notifications", icon: BellRing },
      { id: "barcodes", name: "สอนอ่านบาร์โค้ด", label: "Barcode Learning", href: "/settings/barcodes", icon: ScanLine },
    ],
  },
];

export const ALL_MENUS = NAVIGATION_GROUPS.flatMap((group) => group.items);

export const ROLES = ["Admin", "Manager", "Operator", "User", "Vendor"] as const;

const ROLE_FALLBACK_MENUS: Record<string, string[]> = {
  Admin: ["dashboard", "master_data", "user_management", "rbac"],
  Manager: ["dashboard", "master_data"],
};

export function getRoleFallbackMenus(role: string) {
  return ROLE_FALLBACK_MENUS[role] ?? ["dashboard"];
}

export function mergeMenus(primary: string[], fallback: string[]) {
  return Array.from(new Set([...primary, ...fallback]));
}
