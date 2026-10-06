-- Papelera de Anotaciones (soft delete).
-- deleted_at NULL = activa; con fecha = en papelera. La app purga lo que lleva más de 15 días.
-- Las políticas RLS existentes no cambian: solo el autor actualiza/elimina sus anotaciones.
ALTER TABLE anotacion         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE anotacion_folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_anotacion_deleted         ON anotacion (deleted_at);
CREATE INDEX IF NOT EXISTS idx_anotacion_folders_deleted ON anotacion_folders (deleted_at);
