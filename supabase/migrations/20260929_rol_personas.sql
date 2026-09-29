-- ──────────────────────────────────────────────────────────────────────────────
-- Nuevo rol de sistema 'personas' con los mismos permisos que 'admin'.
--
-- 1. Amplía el CHECK de persona.rol_sistema (incluye 'planificador', que no
--    estaba en la migración 20260601).
-- 2. fn_es_admin(): helper central "admin o personas". Si más adelante admin
--    se restringe, se ajustan los chequeos puntuales, no este helper.
-- 3. Redefine funciones/triggers que comparaban contra 'admin'.
-- 4. Reescribe dinámicamente las políticas RLS que mencionan 'admin'
--    agregando 'personas'. Es idempotente (omite las que ya lo incluyen).
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. CHECK ─────────────────────────────────────────────────────────────────
ALTER TABLE persona DROP CONSTRAINT IF EXISTS persona_rol_sistema_check;
ALTER TABLE persona
  ADD CONSTRAINT persona_rol_sistema_check
  CHECK (rol_sistema IN ('admin', 'personas', 'GyD', 'AySr', 'Desarrollo', 'proposer', 'planificador'));

-- ── 2. Helper ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_es_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas')
  );
$$;

-- ── 3. Funciones existentes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_is_editor_rol()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas', 'planificador')
  );
$$;

CREATE OR REPLACE FUNCTION fn_puede_aprobar_plan()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'personas', 'proposer')
  );
$$;

CREATE OR REPLACE FUNCTION fn_check_rol_sistema_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rol_sistema IS DISTINCT FROM OLD.rol_sistema THEN
    IF auth.uid() IS NOT NULL AND NOT fn_es_admin() THEN
      RAISE EXCEPTION 'Solo un administrador puede modificar el rol de sistema.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION persona_guard_acceso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / SQL Editor → no hay usuario → operación permitida.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.rol_sistema IS NOT NULL OR NEW.acceso_estado IS NOT NULL) AND NOT fn_es_admin() THEN
      RAISE EXCEPTION 'Solo un administrador puede asignar accesos al sistema';
    END IF;

    IF NEW.auth_user_id IS NOT NULL
       AND NOT (NEW.auth_user_id = auth.uid() AND lower(NEW.email) = lower(auth.email()))
       AND NOT fn_es_admin() THEN
      RAISE EXCEPTION 'No tienes permiso para vincular esta persona a una cuenta';
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: rol_sistema / acceso_estado
  IF (NEW.rol_sistema   IS DISTINCT FROM OLD.rol_sistema
   OR NEW.acceso_estado IS DISTINCT FROM OLD.acceso_estado) AND NOT fn_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede modificar accesos al sistema';
  END IF;

  -- UPDATE: auth_user_id. Único caso para no-admin: auto-vínculo con su mismo email.
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    IF NOT (
      OLD.auth_user_id IS NULL
      AND NEW.auth_user_id = auth.uid()
      AND lower(NEW.email) = lower(auth.email())
    ) AND NOT fn_es_admin() THEN
      RAISE EXCEPTION 'No tienes permiso para modificar el vinculo de cuenta de esta persona';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Políticas RLS ─────────────────────────────────────────────────────────
-- Postgres normaliza: `rol_sistema = 'admin'::text` y `ARRAY['admin'::text, ...]`.
DO $$
DECLARE
  pol   record;
  new_q text;
  new_c text;
  sql   text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%''admin''%'
      AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%''personas''%'
  LOOP
    new_q := pol.qual;
    new_c := pol.with_check;

    -- ARRAY['admin'::t, ...] → ARRAY['admin'::t, 'personas'::t, ...]
    new_q := regexp_replace(new_q, $r$ARRAY\['admin'::([a-z ]+)$r$, $r$ARRAY['admin'::\1, 'personas'::\1$r$, 'g');
    new_c := regexp_replace(new_c, $r$ARRAY\['admin'::([a-z ]+)$r$, $r$ARRAY['admin'::\1, 'personas'::\1$r$, 'g');
    -- = 'admin'::t → = ANY (ARRAY['admin'::t, 'personas'::t])
    new_q := regexp_replace(new_q, $r$= 'admin'::([a-z ]+)$r$, $r$= ANY (ARRAY['admin'::\1, 'personas'::\1])$r$, 'g');
    new_c := regexp_replace(new_c, $r$= 'admin'::([a-z ]+)$r$, $r$= ANY (ARRAY['admin'::\1, 'personas'::\1])$r$, 'g');

    sql := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    IF new_q IS NOT NULL THEN sql := sql || ' USING (' || new_q || ')'; END IF;
    IF new_c IS NOT NULL THEN sql := sql || ' WITH CHECK (' || new_c || ')'; END IF;

    RAISE NOTICE 'Actualizando política %.%', pol.tablename, pol.policyname;
    EXECUTE sql;
  END LOOP;
END;
$$;
