import sql from "@/lib/db";
import type { LineBotAccess } from "@/lib/line-liff-ordering";
import { isLabPurchasingRole } from "@/lib/purchase-order-workflow";
import { andDept, type DepartmentScope } from "@/lib/scoped-db";

// PO / tracking lookups and the command decision for the LINE webhook. The actor says whose eyes the lookup runs with:
// legacy (switch off, or switch on with departments not ready for a linked Admin/Manager) keeps the original statements, a lab
// actor stays inside one department, a vendor actor sees only its own vendor (across departments, like the vendor web pages).

export type LineBotActor =
  | { kind: "legacy" }
  | { kind: "lab"; scope: { mode: "one"; departmentId: number } }
  | { kind: "vendor"; vendor: string };

export type LineBotDecision =
  | { ok: false; message: string }
  | { ok: true; command: "stock"; scope: DepartmentScope }
  | { ok: true; command: "purchasing"; actor: LineBotActor };

export const LINE_BOT_MESSAGES = {
  unlinked: 'บัญชี LINE นี้ยังไม่ได้ผูกกับบัญชี LabStock กรุณาผูกบัญชีก่อนใช้งานค่ะ (พิมพ์ "id" เพื่อดู LINE User ID)',
  noWork: "ยังไม่มีงานที่ใช้งานได้ กรุณาแจ้งผู้ดูแลระบบ",
  purchasingDenied: "สิทธิ์ของคุณไม่สามารถดูใบสั่งซื้อหรือพัสดุผ่านบอทได้ (เฉพาะผู้จัดการและผู้ดูแลระบบ)",
  vendorStockDenied: "บัญชีผู้ขายไม่สามารถดูสต็อกผ่านบอทได้ ใช้ได้เฉพาะการค้นหาใบสั่งซื้อ (PO-...) และเลขพัสดุ",
};

export function decideLineBotCommand(access: LineBotAccess, command: "stock" | "purchasing"): LineBotDecision {
  switch (access.state) {
    case "legacy":
      return command === "stock"
        ? { ok: true, command: "stock", scope: { mode: "legacy" } }
        : { ok: true, command: "purchasing", actor: { kind: "legacy" } };
    case "degraded":
      // Switch on, departments not ready: the account is linked and active, but no department is known, so the answers are
      // unfiltered (legacy statements). Purchasing still needs Admin/Manager.
      if (command === "stock") return { ok: true, command: "stock", scope: { mode: "legacy" } };
      return isLabPurchasingRole(access.role)
        ? { ok: true, command: "purchasing", actor: { kind: "legacy" } }
        : { ok: false, message: LINE_BOT_MESSAGES.purchasingDenied };
    case "unlinked":
      return { ok: false, message: LINE_BOT_MESSAGES.unlinked };
    case "no_work":
      return { ok: false, message: LINE_BOT_MESSAGES.noWork };
    case "vendor":
      return command === "stock"
        ? { ok: false, message: LINE_BOT_MESSAGES.vendorStockDenied }
        : { ok: true, command: "purchasing", actor: { kind: "vendor", vendor: access.vendor } };
    case "lab":
      if (command === "stock") return { ok: true, command: "stock", scope: access.scope };
      return isLabPurchasingRole(access.role)
        ? { ok: true, command: "purchasing", actor: { kind: "lab", scope: access.scope } }
        : { ok: false, message: LINE_BOT_MESSAGES.purchasingDenied };
    default:
      // Unknown state: fail closed.
      return { ok: false, message: LINE_BOT_MESSAGES.unlinked };
  }
}

// Fail closed: andDept() treats any non-"one" scope as "no filter", so a malformed actor must stop here, before any SQL.
function assertActor(actor: LineBotActor | undefined): asserts actor is LineBotActor {
  const a = actor as { kind?: unknown; scope?: { mode?: unknown; departmentId?: unknown }; vendor?: unknown } | null | undefined;
  if (typeof a !== "object" || a === null) throw new Error("LINE bot queries require a LineBotActor");
  if (a.kind === "legacy") return;
  if (a.kind === "lab") {
    const id = a.scope?.departmentId;
    if (a.scope?.mode === "one" && typeof id === "number" && Number.isInteger(id) && id > 0) return;
  } else if (a.kind === "vendor") {
    if (typeof a.vendor === "string") return;
  }
  throw new Error("LINE bot queries require a LineBotActor");
}

export async function findPurchaseOrderForLine(poNumber: string, actor: LineBotActor): Promise<Record<string, unknown> | null> {
  assertActor(actor);
  if (actor.kind === "legacy") {
    const rows = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}`;
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (actor.kind === "lab") {
    const rows = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber}${andDept(actor.scope)}`;
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  // Vendor: blank name matches nothing (never vendor = ''); the query keeps the untrimmed value like vendor/shipments/route.ts.
  if (!actor.vendor.trim()) return null;
  const rows = await sql`SELECT * FROM purchase_orders WHERE po_number = ${poNumber} AND vendor = ${actor.vendor} AND status <> 'PENDING_MANAGER_REVIEW'`;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function findShipmentForLine(trackingNo: string, actor: LineBotActor): Promise<Record<string, unknown> | null> {
  assertActor(actor);
  if (actor.kind === "legacy") {
    const rows = await sql`SELECT * FROM shipments WHERE tracking_no = ${trackingNo}`;
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (actor.kind === "lab") {
    const rows = await sql`SELECT * FROM shipments WHERE tracking_no = ${trackingNo}${andDept(actor.scope)}`;
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (!actor.vendor.trim()) return null;
  const rows = await sql`SELECT * FROM shipments WHERE tracking_no = ${trackingNo} AND vendor = ${actor.vendor}`;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}
