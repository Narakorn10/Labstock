-- Prepared only. Do not apply without the separately authorized migration gate.
CREATE TABLE IF NOT EXISTS purchase_order_ai_review_audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  model TEXT NOT NULL,
  input_fingerprint CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  result_json JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_order_ai_review_rate_limits (
  actor TEXT NOT NULL,
  vendor_fingerprint CHAR(64) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor, vendor_fingerprint)
);
