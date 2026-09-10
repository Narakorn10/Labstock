import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth-utils';

const SOURCE_VERIFICATION_STATUSES = [
  'VERIFIED',
  'NEEDS_REVIEW',
  'NOT_AVAILABLE',
] as const;

type SourceVerificationStatus = (typeof SOURCE_VERIFICATION_STATUSES)[number];

type PolicyPayload = {
  item_id: string;
  expected_revision: number;
  tests_per_box: number | null;
  avg_patient_tests_per_month: number;
  iqc_tests_per_month: number;
  documented_actual_withdrawal_boxes: number | null;
  source_verification_status: SourceVerificationStatus;
  approved_monthly_target_boxes: number | null;
  approved_order_qty_boxes: number | null;
  orders_per_month: number;
  lead_time_days: number;
  safety_stock_boxes: number | null;
  min_order_qty_boxes: number;
  order_multiple_boxes: number;
  review_days: number;
  enabled: boolean;
  reason: string | null;
  change_reason: string;
};

async function requirePolicyManager(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (user.role !== 'Admin' && user.role !== 'Manager') {
    return { response: NextResponse.json({ error: 'เฉพาะ Admin หรือ Manager เท่านั้น' }, { status: 403 }) };
  }

  return { user };
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, field: string, options: { required?: boolean; maxLength?: number } = {}) {
  if (value === null || value === undefined) {
    return options.required ? { error: `${field} is required.` } : { value: null };
  }

  if (typeof value !== 'string') {
    return { error: `${field} must be text.` };
  }

  const normalized = value.trim();
  if (options.required && !normalized) {
    return { error: `${field} is required.` };
  }

  if (options.maxLength && normalized.length > options.maxLength) {
    return { error: `${field} is too long.` };
  }

  return { value: normalized || null };
}

function numberValue(
  value: unknown,
  field: string,
  options: { nullable?: boolean; minimum?: number; maximum?: number; integer?: boolean } = {},
) {
  if (value === null) {
    return options.nullable ? { value: null } : { error: `${field} is required.` };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: `${field} must be a finite number.` };
  }

  if (options.integer && !Number.isInteger(value)) {
    return { error: `${field} must be an integer.` };
  }

  if (options.minimum !== undefined && value < options.minimum) {
    return { error: `${field} must be at least ${options.minimum}.` };
  }

  if (options.maximum !== undefined && value > options.maximum) {
    return { error: `${field} must be at most ${options.maximum}.` };
  }

  return { value };
}

function validatePayload(body: unknown): { payload?: PolicyPayload; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object.' };
  }

  const input = body as Record<string, unknown>;
  const requiredFields = [
    'item_id',
    'expected_revision',
    'tests_per_box',
    'avg_patient_tests_per_month',
    'iqc_tests_per_month',
    'documented_actual_withdrawal_boxes',
    'source_verification_status',
    'approved_monthly_target_boxes',
    'approved_order_qty_boxes',
    'orders_per_month',
    'lead_time_days',
    'safety_stock_boxes',
    'min_order_qty_boxes',
    'order_multiple_boxes',
    'enabled',
    'reason',
    'change_reason',
  ];
  const missing = requiredFields.find((field) => !hasOwn(input, field));
  if (missing) return { error: `${missing} is required.` };

  const itemId = text(input.item_id, 'item_id', { required: true, maxLength: 160 });
  const expectedRevision = numberValue(input.expected_revision, 'expected_revision', { minimum: 0, integer: true });
  const testsPerBox = numberValue(input.tests_per_box, 'tests_per_box', { nullable: true, minimum: Number.MIN_VALUE });
  const averageTests = numberValue(input.avg_patient_tests_per_month, 'avg_patient_tests_per_month', { minimum: 0 });
  const iqcTests = numberValue(input.iqc_tests_per_month, 'iqc_tests_per_month', { minimum: 0 });
  const actualDocumentQty = numberValue(input.documented_actual_withdrawal_boxes, 'documented_actual_withdrawal_boxes', { nullable: true, minimum: 0 });
  const approvedMonthly = numberValue(input.approved_monthly_target_boxes, 'approved_monthly_target_boxes', { nullable: true, minimum: 0 });
  const approvedCycle = numberValue(input.approved_order_qty_boxes, 'approved_order_qty_boxes', { nullable: true, minimum: 0, integer: true });
  const ordersPerMonth = numberValue(input.orders_per_month, 'orders_per_month', { minimum: 1, integer: true });
  const leadTime = numberValue(input.lead_time_days, 'lead_time_days', { minimum: 0, integer: true });
  const safetyStock = numberValue(input.safety_stock_boxes, 'safety_stock_boxes', { nullable: true, minimum: 0 });
  const minOrderQty = numberValue(input.min_order_qty_boxes, 'min_order_qty_boxes', { minimum: 1, integer: true });
  const orderMultiple = numberValue(input.order_multiple_boxes, 'order_multiple_boxes', { minimum: 1, integer: true });
  const reviewDays = numberValue(input.review_days, 'review_days', { minimum: 1, maximum: 365, integer: true });
  const reason = text(input.reason, 'reason', { maxLength: 2_000 });
  const changeReason = text(input.change_reason, 'change_reason', { required: true, maxLength: 2_000 });

  const validationError = [itemId, expectedRevision, testsPerBox, averageTests, iqcTests, actualDocumentQty, approvedMonthly, approvedCycle, ordersPerMonth, leadTime, safetyStock, minOrderQty, orderMultiple, reviewDays, reason, changeReason]
    .find((result) => 'error' in result);
  if (validationError && 'error' in validationError) return { error: validationError.error };

  if (typeof input.enabled !== 'boolean') {
    return { error: 'enabled must be true or false.' };
  }
  if (typeof input.source_verification_status !== 'string' || !SOURCE_VERIFICATION_STATUSES.includes(input.source_verification_status as SourceVerificationStatus)) {
    return { error: `source_verification_status must be one of: ${SOURCE_VERIFICATION_STATUSES.join(', ')}.` };
  }

  return {
    payload: {
      item_id: itemId.value as string,
      expected_revision: expectedRevision.value as number,
      tests_per_box: testsPerBox.value as number | null,
      avg_patient_tests_per_month: averageTests.value as number,
      iqc_tests_per_month: iqcTests.value as number,
      documented_actual_withdrawal_boxes: actualDocumentQty.value as number | null,
      source_verification_status: input.source_verification_status as SourceVerificationStatus,
      approved_monthly_target_boxes: approvedMonthly.value as number | null,
      approved_order_qty_boxes: approvedCycle.value as number | null,
      orders_per_month: ordersPerMonth.value as number,
      lead_time_days: leadTime.value as number,
      safety_stock_boxes: safetyStock.value as number | null,
      min_order_qty_boxes: minOrderQty.value as number,
      order_multiple_boxes: orderMultiple.value as number,
      review_days: reviewDays.value as number,
      enabled: input.enabled,
      reason: reason.value as string | null,
      change_reason: changeReason.value as string,
    },
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requirePolicyManager(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const keyword = (url.searchParams.get('q') || '').trim().slice(0, 160);
    const rawLimit = Number(url.searchParams.get('limit') || 150);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 300)) : 150;
    const searchTerm = `%${keyword}%`;
    const policies = await sql`
      SELECT
        m.item_id, m.name, m.barcode, m.unit, m.vendor, m.reagent_type, m.machine_type,
        p.tests_per_box, COALESCE(p.avg_patient_tests_per_month, 0) AS avg_patient_tests_per_month,
        COALESCE(p.iqc_tests_per_month, 0) AS iqc_tests_per_month,
        p.documented_actual_withdrawal_boxes, COALESCE(p.source_verification_status, 'NOT_AVAILABLE') AS source_verification_status,
        p.approved_monthly_target_boxes, p.approved_order_qty_boxes, COALESCE(p.orders_per_month, 2) AS orders_per_month,
        COALESCE(p.lead_time_days, 7) AS lead_time_days, p.safety_stock_boxes,
        COALESCE(p.min_order_qty_boxes, 1) AS min_order_qty_boxes,
        COALESCE(p.order_multiple_boxes, 1) AS order_multiple_boxes,
        COALESCE(p.review_days, 15) AS review_days,
        COALESCE(p.enabled, false) AS enabled, p.reason, COALESCE(p.revision, 0) AS revision,
        (p.item_id IS NOT NULL) AS policy_configured,
        p.created_at, p.created_by, p.updated_at, p.updated_by,
        CASE WHEN p.tests_per_box IS NULL OR p.tests_per_box <= 0 THEN NULL
          ELSE ROUND((p.avg_patient_tests_per_month + p.iqc_tests_per_month) / p.tests_per_box)
        END AS theoretical_monthly_boxes,
        CASE WHEN p.approved_order_qty_boxes IS NULL THEN NULL
          ELSE p.approved_order_qty_boxes * p.orders_per_month
        END AS approved_monthly_from_cycle_boxes
      FROM master_data m
      LEFT JOIN reagent_order_policy p ON m.item_id = p.item_id
      WHERE (${keyword} = ''
        OR m.item_id ILIKE ${searchTerm}
        OR m.name ILIKE ${searchTerm}
        OR COALESCE(m.barcode, '') ILIKE ${searchTerm}
        OR COALESCE(m.vendor, '') ILIKE ${searchTerm})
      ORDER BY p.enabled DESC, m.name ASC, p.item_id ASC
      LIMIT ${limit}
    `;
    return NextResponse.json({ data: policies });
  } catch (error: unknown) {
    console.error('Reagent order policy GET error:', error);
    return NextResponse.json({ error: 'Unable to load reagent order policies.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePolicyManager(request);
    if ('response' in auth) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const validation = validatePayload(body);
    if (!validation.payload) return NextResponse.json({ error: validation.error }, { status: 400 });
    const policy = validation.payload;
    if (policy.expected_revision !== 0) {
      return NextResponse.json({ error: 'การสร้างนโยบายใหม่ต้องใช้ expected_revision เป็น 0' }, { status: 400 });
    }

    const [createdRows] = await sql.transaction([sql`
      WITH master AS (
        SELECT item_id
        FROM master_data
        WHERE item_id = ${policy.item_id}
        FOR SHARE
      ),
      created AS (
        INSERT INTO reagent_order_policy (
          item_id, tests_per_box, avg_patient_tests_per_month, iqc_tests_per_month,
          documented_actual_withdrawal_boxes, source_verification_status,
          approved_monthly_target_boxes, approved_order_qty_boxes, orders_per_month,
          lead_time_days, safety_stock_boxes, min_order_qty_boxes, order_multiple_boxes,
          review_days, enabled, reason, revision, created_by, updated_by
        )
        SELECT
          master.item_id, ${policy.tests_per_box}, ${policy.avg_patient_tests_per_month}, ${policy.iqc_tests_per_month},
          ${policy.documented_actual_withdrawal_boxes}, ${policy.source_verification_status},
          ${policy.approved_monthly_target_boxes}, ${policy.approved_order_qty_boxes}, ${policy.orders_per_month},
          ${policy.lead_time_days}, ${policy.safety_stock_boxes}, ${policy.min_order_qty_boxes}, ${policy.order_multiple_boxes},
          ${policy.review_days}, ${policy.enabled}, ${policy.reason}, 1, ${auth.user.username}, ${auth.user.username}
        FROM master
        ON CONFLICT (item_id) DO NOTHING
        RETURNING *
      ),
      audit AS (
        INSERT INTO reagent_order_policy_history (
          item_id, revision, before_state, after_state, changed_by, changed_at, reason
        )
        SELECT created.item_id, created.revision, '{}'::jsonb, to_jsonb(created), ${auth.user.username}, NOW(), ${policy.change_reason}
        FROM created
        RETURNING item_id
      )
      SELECT * FROM created
    `]);

    if (createdRows.length === 0) {
      return NextResponse.json({ error: 'รายการนี้มีนโยบายอยู่แล้ว หรือไม่พบรหัสน้ำยา กรุณารีเฟรชข้อมูล' }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: createdRows[0] }, { status: 201 });
  } catch (error: unknown) {
    console.error('Reagent order policy POST error:', error);
    return NextResponse.json({ error: 'Unable to create reagent order policy.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requirePolicyManager(request);
    if ('response' in auth) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const validation = validatePayload(body);
    if (!validation.payload) return NextResponse.json({ error: validation.error }, { status: 400 });
    const policy = validation.payload;

    const [updatedRows] = await sql.transaction([sql`
      WITH current_policy AS (
        SELECT p.*
        FROM reagent_order_policy p
        WHERE p.item_id = ${policy.item_id} AND p.revision = ${policy.expected_revision}
        FOR UPDATE
      ),
      updated_policy AS (
        UPDATE reagent_order_policy p
        SET tests_per_box = ${policy.tests_per_box},
            avg_patient_tests_per_month = ${policy.avg_patient_tests_per_month},
            iqc_tests_per_month = ${policy.iqc_tests_per_month},
            documented_actual_withdrawal_boxes = ${policy.documented_actual_withdrawal_boxes},
            source_verification_status = ${policy.source_verification_status},
            approved_monthly_target_boxes = ${policy.approved_monthly_target_boxes},
            approved_order_qty_boxes = ${policy.approved_order_qty_boxes},
            orders_per_month = ${policy.orders_per_month},
            lead_time_days = ${policy.lead_time_days},
            safety_stock_boxes = ${policy.safety_stock_boxes},
            min_order_qty_boxes = ${policy.min_order_qty_boxes},
            order_multiple_boxes = ${policy.order_multiple_boxes},
            review_days = ${policy.review_days},
            enabled = ${policy.enabled},
            reason = ${policy.reason},
            revision = p.revision + 1,
            updated_at = NOW(),
            updated_by = ${auth.user.username}
        FROM current_policy current
        WHERE p.item_id = current.item_id AND p.revision = current.revision
        RETURNING p.*
      ),
      audit AS (
        INSERT INTO reagent_order_policy_history (
          item_id, revision, before_state, after_state, changed_by, changed_at, reason
        )
        SELECT updated.item_id, updated.revision, to_jsonb(current), to_jsonb(updated),
               ${auth.user.username}, NOW(), ${policy.change_reason}
        FROM updated_policy updated
        INNER JOIN current_policy current ON current.item_id = updated.item_id
        RETURNING item_id
      )
      SELECT updated.* FROM updated_policy updated
    `]);

    if (updatedRows.length === 0) {
      return NextResponse.json(
        { error: 'Policy was changed by another user or no longer exists. Reload and review before saving again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: updatedRows[0] });
  } catch (error: unknown) {
    console.error('Reagent order policy PATCH error:', error);
    return NextResponse.json({ error: 'Unable to update reagent order policy.' }, { status: 500 });
  }
}
