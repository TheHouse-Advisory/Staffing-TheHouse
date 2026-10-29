-- ──────────────────────────────────────────────────────────────────────────────
-- Planificador pasa a solo lectura en la base.
--
-- Antes: fn_is_editor_rol incluía 'planificador', así que podía escribir en casi
-- todas las tablas (asignaciones, proyectos, personas…) llamando a Supabase directo,
-- aunque la app lo trata como solo lectura y Planificación está desactivada.
--
-- Ahora: solo admin y personas son editores. Planificador conserva la lectura
-- (fn_tiene_acceso no cambia).
-- Para revertir cuando se reactive Planificación: volver a agregar 'planificador'.
--
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION fn_is_editor_rol()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas')
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

COMMIT;
