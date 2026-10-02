import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireBarcodeLearningV2Access } from '@/lib/barcode-learning-auth';
import {
  barcodeV2PayloadFromStoredRow,
  mapBarcodeV2Row,
  validateBarcodeV2Payload,
} from '@/lib/barcode-learning-v2';

function activationLockQuery() {
  return sql`
    SELECT pg_advisory_xact_lock(hashtextextended('barcode_pattern_v2_activation', 0))
  `;
}

function activeConflictNames(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((conflict) => {
    const row = conflict && typeof conflict === 'object' ? conflict as Record<string, unknown> : {};
    return String(row.name || row.id || 'unknown');
  });
}

function isUniqueActiveRegexConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBarcodeLearningV2Access(request);
  if (access.response || !access.user) return access.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const current = await sql`SELECT * FROM barcode_pattern_v2 WHERE id = ${id} LIMIT 1`;
    if (!current.length) return NextResponse.json({ error: 'Pattern not found.' }, { status: 404 });
    const before = current[0] as Record<string, unknown>;
    if (before.status !== 'VERIFIED') {
      return NextResponse.json({ error: 'Pattern must pass verification before Activate.' }, { status: 409 });
    }

    // Rebuild the payload from persisted columns every time. The old
    // verification JSON is evidence of a prior check, not authorization to run.
    const payload = barcodeV2PayloadFromStoredRow(before);
    const verificationResult = await validateBarcodeV2Payload(payload, {
      excludePatternId: Number(before.id),
    });
    if (verificationResult.verification.status !== 'VERIFIED') {
      const [, refreshedRows] = await sql.transaction([activationLockQuery(), sql`
        WITH current AS (
          SELECT p.*
          FROM barcode_pattern_v2 p
          WHERE p.id = ${id} AND p.status = 'VERIFIED' AND p.updated_at = ${before.updated_at}
          FOR UPDATE
        ), updated AS (
          UPDATE barcode_pattern_v2 p
          SET status = 'DRAFT', verification = ${JSON.stringify(verificationResult.verification)}::jsonb,
              updated_by = ${access.user.username}, updated_at = NOW()
          FROM current
          WHERE p.id = current.id
          RETURNING p.*
        ), audit AS (
          INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, before_json, after_json)
          SELECT updated.id, 'VALIDATE', ${access.user.username}, to_jsonb(current), to_jsonb(updated)
          FROM updated
          INNER JOIN current ON current.id = updated.id
        )
        SELECT updated.* FROM updated
      `]);
      if (!refreshedRows.length) {
        return NextResponse.json({ error: 'Pattern changed before revalidation completed. Reload and review it again.' }, { status: 409 });
      }
      return NextResponse.json({
        error: 'Pattern no longer passes current validation. It has been returned to Draft for review.',
        data: { verification: verificationResult.verification },
      }, { status: 409 });
    }

    const [, activationRows] = await sql.transaction([activationLockQuery(), sql`
      WITH current AS (
        SELECT p.*
        FROM barcode_pattern_v2 p
        WHERE p.id = ${id} AND p.status = 'VERIFIED' AND p.updated_at = ${before.updated_at}
        FOR UPDATE
      ), candidate AS (
        SELECT current.*, ${verificationResult.regex_pattern}::text AS verified_regex
        FROM current
      ), conflicts AS (
        SELECT active.id, active.name
        FROM barcode_pattern_v2 active
        CROSS JOIN candidate
        WHERE active.status = 'ACTIVE'
          AND active.id <> candidate.id
          AND (
            active.regex_pattern = candidate.verified_regex
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(candidate.examples) = 'array' THEN candidate.examples ELSE '[]'::jsonb END
              ) AS candidate_example
              WHERE COALESCE(candidate_example ->> 'raw_barcode', '') <> ''
                AND (candidate_example ->> 'raw_barcode') ~ active.regex_pattern
            )
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(active.examples) = 'array' THEN active.examples ELSE '[]'::jsonb END
              ) AS active_example
              WHERE COALESCE(active_example ->> 'raw_barcode', '') <> ''
                AND (active_example ->> 'raw_barcode') ~ candidate.verified_regex
            )
          )
      ), updated AS (
        UPDATE barcode_pattern_v2 p
        SET status = 'ACTIVE', regex_pattern = candidate.verified_regex,
            item_id_group = ${verificationResult.item_id_group}, lot_no_group = ${verificationResult.lot_no_group},
            exp_date_group = ${verificationResult.exp_date_group},
            verification = ${JSON.stringify(verificationResult.verification)}::jsonb,
            activated_by = ${access.user.username}, activated_at = NOW(),
            deactivated_by = NULL, deactivation_reason = NULL, deactivated_at = NULL,
            updated_by = ${access.user.username}, updated_at = NOW()
        FROM candidate
        WHERE p.id = candidate.id AND NOT EXISTS (SELECT 1 FROM conflicts)
        RETURNING p.*
      ), audit AS (
        INSERT INTO barcode_pattern_v2_audit (pattern_id, action, actor, before_json, after_json)
        SELECT updated.id, 'ACTIVATE', ${access.user.username}, to_jsonb(candidate), to_jsonb(updated)
        FROM updated
        INNER JOIN candidate ON candidate.id = updated.id
      )
      SELECT
        (SELECT to_jsonb(updated) FROM updated) AS pattern,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb) FROM conflicts) AS conflicts
    `]);
    const activation = activationRows[0] as { pattern?: Record<string, unknown> | null; conflicts?: unknown } | undefined;
    if (!activation?.pattern) {
      const conflicts = activeConflictNames(activation?.conflicts);
      return NextResponse.json({
        error: conflicts.length
          ? `Pattern conflicts with active V2 pattern: ${conflicts.join(', ')}`
          : 'Pattern changed before Activate completed. Reload and review it again.',
      }, { status: 409 });
    }
    const after = activation.pattern;
    return NextResponse.json({ success: true, data: { pattern: mapBarcodeV2Row(after) }, message: 'เปิดใช้รูปแบบแล้ว โดย V1 จะถูกอ่านก่อนเสมอ' });
  } catch (error: unknown) {
    console.error('Barcode V2 activate error:', error);
    if (isUniqueActiveRegexConflict(error)) {
      return NextResponse.json({ error: 'Pattern conflicts with an active V2 pattern. Reload and review it again.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to activate barcode pattern.' }, { status: 500 });
  }
}
