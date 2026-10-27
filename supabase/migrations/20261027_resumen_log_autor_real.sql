-- ──────────────────────────────────────────────────────────────────────────────
-- resumen_proyectos_log: "Último cambio realizado por X" confiable.
--
-- Antes: cualquier sesión (incluso sin acceso vigente) podía leer e insertar,
-- y el nombre del autor lo enviaba el navegador, así que se podía escribir
-- "Último cambio realizado por <cualquier persona>".
--
-- Ahora:
--   · leer   → usuarios con acceso vigente (fn_tiene_acceso)
--   · crear  → solo editores (los únicos que pueden editar asignaciones)
--   · el nombre del autor lo fija la base de datos desde la persona logueada
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP POLICY IF EXISTS "resumen_proyectos_log: lectura autenticados" ON resumen_proyectos_log;
DROP POLICY IF EXISTS "resumen_proyectos_log: insertar autenticados" ON resumen_proyectos_log;
DROP POLICY IF EXISTS "resumen_proyectos_log: lectura" ON resumen_proyectos_log;
DROP POLICY IF EXISTS "resumen_proyectos_log: crear editor" ON resumen_proyectos_log;

CREATE POLICY "resumen_proyectos_log: lectura" ON resumen_proyectos_log
  FOR SELECT TO authenticated USING (fn_tiene_acceso());
CREATE POLICY "resumen_proyectos_log: crear editor" ON resumen_proyectos_log
  FOR INSERT TO authenticated WITH CHECK (fn_is_editor_rol());
-- Sin UPDATE/DELETE: el registro no se puede editar ni borrar desde la app

CREATE OR REPLACE FUNCTION resumen_log_fijar_autor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nombre text;
BEGIN
  -- service_role / SQL Editor (auth.uid() NULL): se respeta lo enviado
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT trim(concat_ws(' ', p.nombre, p.apellido)) INTO v_nombre
  FROM persona p WHERE p.auth_user_id = auth.uid() LIMIT 1;
  NEW.actor_nombre := COALESCE(NULLIF(v_nombre, ''), 'Usuario desconocido');
  NEW.creado_en := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resumen_log_fijar_autor ON resumen_proyectos_log;
CREATE TRIGGER trg_resumen_log_fijar_autor
  BEFORE INSERT ON resumen_proyectos_log
  FOR EACH ROW EXECUTE FUNCTION resumen_log_fijar_autor();

COMMIT;
