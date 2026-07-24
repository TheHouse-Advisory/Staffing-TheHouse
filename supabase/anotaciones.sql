-- ──────────────────────────────────────────────────────────────────────────────
-- anotaciones.sql
--
-- Tabla `anotacion`: registro de notas/observaciones del equipo (seccion
-- "Anotaciones" del sidebar). Acceso exclusivo para rol 'admin' (lectura y
-- escritura) via fn_is_admin_rol() — nadie mas puede ver ni modificar filas.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anotacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  titulo      text NOT NULL,
  contenido   text NOT NULL,
  categoria   text,
  autor_id    uuid REFERENCES persona(id)
);

-- Metadatos de autoria: nombre (no FK) de quien crea/edita, para mostrar en la UI.
ALTER TABLE anotacion ADD COLUMN IF NOT EXISTS creado_por text;
ALTER TABLE anotacion ADD COLUMN IF NOT EXISTS editado_por text;
ALTER TABLE anotacion ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION fn_is_admin_rol()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema = 'admin'
  );
$$;

ALTER TABLE anotacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anotacion: lectura autenticados" ON anotacion;
DROP POLICY IF EXISTS "anotacion: lectura admin" ON anotacion;
CREATE POLICY "anotacion: lectura admin" ON anotacion
  FOR SELECT USING (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion: crear admin/planificador" ON anotacion;
DROP POLICY IF EXISTS "anotacion: crear admin" ON anotacion;
CREATE POLICY "anotacion: crear admin" ON anotacion
  FOR INSERT WITH CHECK (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion: editar admin/planificador" ON anotacion;
DROP POLICY IF EXISTS "anotacion: editar admin" ON anotacion;
CREATE POLICY "anotacion: editar admin" ON anotacion
  FOR UPDATE USING (fn_is_admin_rol()) WITH CHECK (fn_is_admin_rol());

DROP POLICY IF EXISTS "anotacion: eliminar admin/planificador" ON anotacion;
DROP POLICY IF EXISTS "anotacion: eliminar admin" ON anotacion;
CREATE POLICY "anotacion: eliminar admin" ON anotacion
  FOR DELETE USING (fn_is_admin_rol());
