-- ──────────────────────────────────────────────────────────────────────────────
-- add_anotacion_folders.sql
--
-- Carpetas anidadas para el modulo de Anotaciones. Acceso exclusivo admin
-- (misma politica que `anotacion`, via fn_is_admin_rol() de anotaciones.sql).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anotacion_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  nombre      text NOT NULL,
  parent_id   uuid REFERENCES anotacion_folders(id) ON DELETE CASCADE,
  creado_por  text
);

ALTER TABLE anotacion ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES anotacion_folders(id) ON DELETE SET NULL;

ALTER TABLE anotacion_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anotacion_folders: lectura admin" ON anotacion_folders;
CREATE POLICY "anotacion_folders: lectura admin" ON anotacion_folders
  FOR SELECT USING (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion_folders: crear admin" ON anotacion_folders;
CREATE POLICY "anotacion_folders: crear admin" ON anotacion_folders
  FOR INSERT WITH CHECK (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion_folders: editar admin" ON anotacion_folders;
CREATE POLICY "anotacion_folders: editar admin" ON anotacion_folders
  FOR UPDATE USING (fn_is_admin_rol()) WITH CHECK (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion_folders: eliminar admin" ON anotacion_folders;
CREATE POLICY "anotacion_folders: eliminar admin" ON anotacion_folders
  FOR DELETE USING (fn_is_admin_rol());
