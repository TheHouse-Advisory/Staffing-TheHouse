-- ──────────────────────────────────────────────────────────────────────────────
-- Los helpers de RLS exigen rol de sistema y acceso vigente.
--
-- Antes: una persona suspendida o a la que se le quitó el acceso (rol NULL)
-- seguía pasando fn_tiene_acceso / fn_is_editor_rol / fn_es_admin si llamaba
-- a Supabase directo, porque solo la app revisaba acceso_estado.
--
-- Acceso vigente = rol_sistema no nulo y acceso_estado 'invitada' o 'activa'.
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION fn_tiene_acceso()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IS NOT NULL
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

CREATE OR REPLACE FUNCTION fn_es_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas')
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

CREATE OR REPLACE FUNCTION fn_is_editor_rol()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas', 'planificador')
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

CREATE OR REPLACE FUNCTION fn_puede_aprobar_plan()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas', 'proposer')
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

-- Usada solo por las políticas de anotacion y sus carpetas
CREATE OR REPLACE FUNCTION fn_is_admin_rol()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema = 'personas'
      AND p.acceso_estado IN ('invitada', 'activa')
  );
$$;

COMMIT;
