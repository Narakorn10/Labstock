-- v26: minimum remaining shelf life on receipt (ISO 15189 reagent acceptance).
-- Additive only. NULL min_shelf_life_days means "no rule" for that reagent.
-- Apply on a Neon test branch first; production requires explicit approval.

ALTER TABLE master_data
  ADD COLUMN IF NOT EXISTS min_shelf_life_days INTEGER
    CHECK (min_shelf_life_days IS NULL OR min_shelf_life_days BETWEEN 0 AND 3650);

-- Reason recorded when the Lab accepts a lot below the minimum as a documented exception.
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS shelf_life_override_reason TEXT;
