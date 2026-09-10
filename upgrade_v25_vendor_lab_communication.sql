-- Vendor <-> Lab communication, durable notifications, and shipment idempotency.
-- Additive and idempotent. Apply to Preview first, then Production.

BEGIN;

CREATE OR REPLACE FUNCTION labstock_assert(condition BOOLEAN, error_message TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(condition, FALSE) THEN
    RAISE EXCEPTION '%', error_message USING ERRCODE = '55000';
  END IF;
  RETURN TRUE;
END;
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS notify_po_status_updates BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE shipment_batches
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_batches_vendor_client_request
  ON shipment_batches (vendor, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_batches_vendor_request_fingerprint
  ON shipment_batches (vendor, request_fingerprint)
  WHERE request_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_order_events (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT,
  po_number TEXT NOT NULL,
  shipment_id BIGINT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_username TEXT,
  actor_role TEXT,
  source TEXT NOT NULL DEFAULT 'WEB',
  visibility TEXT NOT NULL DEFAULT 'BOTH'
    CHECK (visibility IN ('LAB', 'VENDOR', 'BOTH')),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_events_po_created
  ON purchase_order_events (po_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_order_events_po_number
  ON purchase_order_events (po_number, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT REFERENCES purchase_order_events(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  po_id BIGINT,
  shipment_id BIGINT,
  recipient_username TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('LINE', 'EMAIL')),
  recipient_address TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD', 'SKIPPED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_ready
  ON notification_outbox (status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_po
  ON notification_outbox (po_id, created_at DESC);

INSERT INTO purchase_order_events (po_id, po_number, event_type, to_status, actor_username, actor_role, source, visibility, metadata)
SELECT p.id, p.po_number, 'BASELINE', p.status, p.created_by, 'SYSTEM', 'MIGRATION', 'BOTH', jsonb_build_object('baseline', true)
FROM purchase_orders p
WHERE NOT EXISTS (
  SELECT 1 FROM purchase_order_events e WHERE e.po_id = p.id
);

COMMIT;
