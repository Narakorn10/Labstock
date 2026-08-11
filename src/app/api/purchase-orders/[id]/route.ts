import { NextResponse } from "next/server";
import sql from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth-utils";
import { normalizeNotificationSettings, normalizePurchaseOrder, notifyUsers } from "@/lib/notifications";
import { isLabPurchasingRole, validatePurchaseOrderItems } from "@/lib/purchase-order-workflow";

async function findPurchaseOrder(id: string) {
  return Number.isInteger(Number(id))
    ? sql`SELECT * FROM purchase_orders WHERE id = ${id}`
    : sql`SELECT * FROM purchase_orders WHERE po_number = ${id}`;
}

async function getLabSettings() {
  const rows = await sql`
    SELECT n.* FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role IN ('Admin', 'Manager')
  `;
  return normalizeNotificationSettings(rows);
}

async function getVendorSettings(vendor: string) {
  const rows = await sql`
    SELECT n.* FROM notification_settings n
    JOIN users u ON u.username = n.username
    WHERE u.role = 'Vendor' AND u.vendor = ${vendor}
  `;
  return normalizeNotificationSettings(rows);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const poData = await findPurchaseOrder(id);
    if (poData.length === 0) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const po = poData[0];
    if (user.role === "Vendor" && (po.vendor !== user.vendor || po.status === "PENDING_MANAGER_REVIEW")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await sql`
      SELECT poi.*, COALESCE(inventory.current_qty, 0) AS current_stock_qty
      FROM purchase_order_items poi
      LEFT JOIN (
        SELECT item_id, SUM(quantity) AS current_qty
        FROM inventory
        WHERE quantity > 0
        GROUP BY item_id
      ) inventory ON inventory.item_id = poi.item_id
      WHERE poi.po_id = ${po.id}
      ORDER BY poi.id
    `;
    return NextResponse.json({ ...po, items });
  } catch (error: unknown) {
    console.error("Error fetching purchase order:", error);
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    let action = String(body.action ?? "");
    let status = String(body.status ?? "");
    const note = String(body.vendor_note ?? body.note ?? "").trim();
    const poData = await findPurchaseOrder(id);
    if (poData.length === 0) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const po = poData[0];
    const isVendor = user.role === "Vendor";
    const isLab = isLabPurchasingRole(user.role);
    if ((!isVendor && !isLab) || (isVendor && po.vendor !== user.vendor)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Preserve the legacy web payload while keeping revision side effects tied to explicit actions.
    if (!action && isLab && po.status === "REVISION_REQUESTED") {
      action = status === "CONFIRMED"
        ? "APPROVE_REVISION"
        : status === "REJECTED"
          ? "REJECT_REVISION"
          : "";
    }
    if (!action && isVendor && status === "REJECTED") {
      action = "REJECT";
    }

    let recipientSettings;
    let notificationEvent: "PO_CREATED" | "PO_REVIEW_REQUIRED" | "PO_CONFIRMED" | "PO_STATUS_UPDATED";
    if (isVendor) {
      const canAcknowledge = po.proposal_origin === "LAB" && po.status === "SUBMITTED" && action === "ACKNOWLEDGE";
      const canConfirmAvailability = po.proposal_origin === "LAB" && po.status === "ACKNOWLEDGED" && action === "CONFIRM_AVAILABILITY";
      const canReviseLabOrder = po.proposal_origin === "LAB" && (po.status === "SUBMITTED" || po.status === "ACKNOWLEDGED") &&
        action === "REQUEST_REVISION";
      const canRejectLabOrder = po.proposal_origin === "LAB" && (po.status === "SUBMITTED" || po.status === "ACKNOWLEDGED") &&
        action === "REJECT";
      if (canAcknowledge) status = "ACKNOWLEDGED";
      if (canConfirmAvailability) status = "CONFIRMED";
      if (canReviseLabOrder) status = "REVISION_REQUESTED";
      if (canRejectLabOrder) {
        if (!note) {
          return NextResponse.json({ error: "Please provide a reason when rejecting a purchase order" }, { status: 400 });
        }
        status = "REJECTED";
      }
      if (!canAcknowledge && !canConfirmAvailability && !canReviseLabOrder && !canRejectLabOrder) {
        return NextResponse.json({ error: "Vendor can only acknowledge, confirm availability, request a revision, or reject an eligible Lab purchase order" }, { status: 409 });
      }

      if (canReviseLabOrder) {
        const revisedItems = validatePurchaseOrderItems(body.items);
        if (!revisedItems || !note) {
          return NextResponse.json({ error: "Revised items and a vendor note are required" }, { status: 400 });
        }
        const currentItems = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
        if (currentItems.length !== revisedItems.length || revisedItems.some((item) => !currentItems.some((row) => row.item_id === item.item_id))) {
          return NextResponse.json({ error: "Vendor may revise quantities only; items cannot be added or removed" }, { status: 400 });
        }
        const revisionRows = revisedItems.map((item, index) => ({
          item,
          current: currentItems.find((row) => row.item_id === item.item_id),
          reason: String((body.items as Array<Record<string, unknown>>)[index]?.revision_reason ?? note).trim(),
        }));
        if (revisionRows.some(({ item, current, reason }) => Number(current?.quantity) !== item.quantity && !reason)) {
          return NextResponse.json({ error: "A reason is required for every changed line" }, { status: 400 });
        }
        await Promise.all(revisionRows.map(({ item, reason }) => {
          return sql`
            UPDATE purchase_order_items
            SET revision_qty = ${item.quantity}, revision_reason = ${reason}
            WHERE po_id = ${po.id} AND item_id = ${item.item_id}
          `;
        }));
      }

      if (canConfirmAvailability) {
        const currentItems = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
        const requestedItems = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
        const availabilityRows = currentItems.map((item) => {
          const requested = requestedItems.find((row) => String(row.item_id ?? "") === String(item.item_id));
          const acknowledgedQty = Number(requested?.acknowledged_qty ?? item.quantity);
          const availableQty = Number(requested?.available_qty ?? item.quantity);
          return { item, acknowledgedQty, availableQty };
        });
        if (availabilityRows.some(({ item, acknowledgedQty, availableQty }) =>
          !Number.isFinite(acknowledgedQty) || acknowledgedQty < 0 ||
          !Number.isFinite(availableQty) || availableQty !== Number(item.quantity) || acknowledgedQty !== Number(item.quantity))) {
          return NextResponse.json({ error: "Confirm availability only when every ordered line is available; use REQUEST_REVISION for shortages" }, { status: 409 });
        }
        await Promise.all(availabilityRows.map(({ item, acknowledgedQty, availableQty }) => sql`
          UPDATE purchase_order_items
          SET acknowledged_qty = ${acknowledgedQty}, available_qty = ${availableQty}
          WHERE po_id = ${po.id} AND item_id = ${item.item_id}
        `));
      }

      const updated = await sql`
        UPDATE purchase_orders
        SET status = ${status}, vendor_note = ${note || po.vendor_note},
            acknowledged_at = ${status === "ACKNOWLEDGED" ? new Date().toISOString() : po.acknowledged_at},
            acknowledged_by = ${status === "ACKNOWLEDGED" ? user.username : po.acknowledged_by},
            vendor_response_due_at = ${status === "ACKNOWLEDGED" ? new Date(Date.now() + 5 * 86400000).toISOString() : po.vendor_response_due_at},
            revision_reason = ${status === "REVISION_REQUESTED" ? note : po.revision_reason},
            review_requested_at = ${status === "REVISION_REQUESTED" ? new Date().toISOString() : po.review_requested_at},
            confirmed_at = ${status === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at},
            updated_at = NOW()
        WHERE id = ${po.id} AND status = ${po.status}
        RETURNING *
      `;
      if (!updated.length) {
        return NextResponse.json({ error: "This order changed before the Vendor response completed" }, { status: 409 });
      }
      recipientSettings = await getLabSettings();
      notificationEvent = status === "REVISION_REQUESTED"
        ? "PO_REVIEW_REQUIRED"
        : status === "ACKNOWLEDGED"
          ? "PO_STATUS_UPDATED"
          : status === "CONFIRMED"
            ? "PO_CONFIRMED"
            : "PO_STATUS_UPDATED";
    } else {
      const canUpdateUnacknowledgedLabOrder = po.proposal_origin === "LAB" &&
        (po.status === "PENDING_MANAGER_REVIEW" || po.status === "SUBMITTED") &&
        action === "UPDATE_UNACKNOWLEDGED_LAB_ORDER";
      if (canUpdateUnacknowledgedLabOrder) {
        const updatedItems = validatePurchaseOrderItems(body.items);
        if (!updatedItems) {
          return NextResponse.json({ error: "Updated purchase-order items are required" }, { status: 400 });
        }

        const currentItems = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
        if (currentItems.length !== updatedItems.length || updatedItems.some((item) => !currentItems.some((row) => row.item_id === item.item_id))) {
          return NextResponse.json({ error: "Items cannot be added or removed after the purchase order is created" }, { status: 400 });
        }
        if (updatedItems.some((item) => {
          const current = currentItems.find((row) => row.item_id === item.item_id);
          return Number(current?.quantity) !== item.quantity && !item.override_reason?.trim();
        })) {
          return NextResponse.json({ error: "Please provide a reason for every manually changed quantity" }, { status: 400 });
        }

        const expectedDate = body.expected_date === undefined ? po.expected_date : (body.expected_date || null);
        const itemJson = JSON.stringify(updatedItems);
        const changedRows = await sql`
          WITH input_rows AS (
            SELECT * FROM jsonb_to_recordset(${itemJson}::jsonb) AS item(
              item_id TEXT, item_name TEXT, quantity NUMERIC, unit TEXT,
              selected_basis TEXT, override_reason TEXT
            )
          ), updated_order AS (
            UPDATE purchase_orders
            SET note = ${note || null}, expected_date = ${expectedDate}, updated_at = NOW()
            WHERE id = ${po.id} AND status IN ('PENDING_MANAGER_REVIEW', 'SUBMITTED')
            RETURNING id
          ), updated_items AS (
            UPDATE purchase_order_items poi
            SET item_name = input.item_name,
                quantity = input.quantity,
                unit = input.unit,
                selected_basis = CASE WHEN poi.quantity IS DISTINCT FROM input.quantity THEN 'MANUAL' ELSE poi.selected_basis END,
                override_reason = CASE WHEN poi.quantity IS DISTINCT FROM input.quantity THEN input.override_reason ELSE poi.override_reason END
            FROM input_rows input, updated_order
            WHERE poi.po_id = updated_order.id AND poi.item_id = input.item_id
            RETURNING poi.id
          )
          SELECT
            (SELECT COUNT(*)::int FROM updated_order) AS updated_order_count,
            (SELECT COUNT(*)::int FROM updated_items) AS updated_item_count
        `;
        if (Number(changedRows[0]?.updated_order_count) !== 1 || Number(changedRows[0]?.updated_item_count) !== updatedItems.length) {
          return NextResponse.json({ error: "This order was acknowledged or changed before the update completed" }, { status: 409 });
        }

        recipientSettings = po.status === "SUBMITTED"
          ? await getVendorSettings(String(po.vendor))
          : await getLabSettings();
        notificationEvent = po.status === "SUBMITTED" ? "PO_CREATED" : "PO_STATUS_UPDATED";
      } else {
      const approvingManagerReview = po.proposal_origin === "LAB" && po.status === "PENDING_MANAGER_REVIEW" && action === "APPROVE_MANAGER_REVIEW";
      const rejectingManagerReview = po.proposal_origin === "LAB" && po.status === "PENDING_MANAGER_REVIEW" && action === "REJECT_MANAGER_REVIEW";
      if (approvingManagerReview || rejectingManagerReview) {
        if (!isLab) {
          return NextResponse.json({ error: "Only an Admin or Manager can approve a purchase order before it is sent to the Vendor" }, { status: 403 });
        }
        if (rejectingManagerReview && !note) {
          return NextResponse.json({ error: "Please provide a reason when rejecting a purchase order" }, { status: 400 });
        }

        status = approvingManagerReview ? "SUBMITTED" : "REJECTED";
        const updated = await sql`
          UPDATE purchase_orders
          SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${user.username},
              review_requested_at = COALESCE(review_requested_at, NOW()),
              vendor_note = ${rejectingManagerReview ? note : po.vendor_note},
              updated_at = NOW()
          WHERE id = ${po.id} AND status = 'PENDING_MANAGER_REVIEW'
          RETURNING *
        `;
        if (!updated.length) return NextResponse.json({ error: "This order was already reviewed." }, { status: 409 });

        recipientSettings = approvingManagerReview
          ? await getVendorSettings(String(po.vendor))
          : await getLabSettings();
        notificationEvent = approvingManagerReview ? "PO_CREATED" : "PO_STATUS_UPDATED";
      } else {
      const awaitingLabReview = po.status === "PENDING_LAB_REVIEW" || po.status === "REVISION_REQUESTED";
      const approvingRevision = po.status === "REVISION_REQUESTED" && action === "APPROVE_REVISION";
      const rejectingRevision = po.status === "REVISION_REQUESTED" && action === "REJECT_REVISION";
      if (approvingRevision) status = "CONFIRMED";
      if (rejectingRevision) status = "REJECTED";
      if ((!awaitingLabReview && !approvingRevision && !rejectingRevision) ||
        (status !== "CONFIRMED" && status !== "REJECTED")) {
        return NextResponse.json({ error: "Lab can only confirm or reject an order awaiting Lab review" }, { status: 409 });
      }
      await sql`
        UPDATE purchase_orders
        SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${user.username},
            confirmed_at = ${status === "CONFIRMED" ? new Date().toISOString() : po.confirmed_at},
            updated_at = NOW()
        WHERE id = ${po.id}
      `;
      if (approvingRevision) {
        await sql`UPDATE purchase_order_items SET quantity = COALESCE(revision_qty, quantity), revision_qty = NULL, revision_reason = NULL WHERE po_id = ${po.id}`;
      } else if (rejectingRevision) {
        await sql`UPDATE purchase_order_items SET revision_qty = NULL, revision_reason = NULL WHERE po_id = ${po.id}`;
      }
      recipientSettings = await getVendorSettings(String(po.vendor));
      notificationEvent = status === "CONFIRMED" ? "PO_CONFIRMED" : "PO_STATUS_UPDATED";
      }
      }
    }

    const updatedRows = await sql`SELECT * FROM purchase_orders WHERE id = ${po.id}`;
    const items = await sql`SELECT * FROM purchase_order_items WHERE po_id = ${po.id} ORDER BY id`;
    const fullPO = normalizePurchaseOrder(updatedRows[0], items.map((item) => ({
      item_name: String(item.item_name), quantity: Number(item.quantity), unit: String(item.unit),
    })));
    await notifyUsers(notificationEvent, fullPO, recipientSettings);
    return NextResponse.json({ ...updatedRows[0], items });
  } catch (error: unknown) {
    console.error("Error updating purchase order:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
