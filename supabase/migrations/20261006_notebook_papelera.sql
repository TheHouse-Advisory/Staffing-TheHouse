-- Papelera del Notebook de Desarrollo (soft delete).
-- deleted_at NULL = activo; con fecha = en papelera. La app purga lo que lleva más de 15 días.
ALTER TABLE notebook_folder ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE notebook_note   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notebook_folder_deleted ON notebook_folder (persona_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notebook_note_deleted   ON notebook_note   (persona_id, deleted_at);
