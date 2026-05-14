-- Añade campos de soft-delete a la tabla engagement
ALTER TABLE engagement
  ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ          DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_is_deleted ON engagement (is_deleted);
