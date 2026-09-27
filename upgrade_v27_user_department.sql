-- v27: department (หน่วยงาน) per user, printed as the PO letterhead of orders they create.
-- Additive only. NULL department falls back to lab_profile.department_name.
-- Apply on a Neon test branch first; production requires explicit approval.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT
    CHECK (department IS NULL OR char_length(department) <= 160);
