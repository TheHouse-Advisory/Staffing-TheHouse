-- ════════════════════════════════════════════════════════════════════════════
-- Email de persona opcional
--
-- 1. Permite crear personas sin email (solo recurso de staffing).
--    El índice único sigue funcionando: Postgres no considera duplicados los NULL.
-- 2. Ajusta persona_guard_acceso(): con email NULL, la comparación
--    lower(NEW.email) = lower(auth.email()) daba NULL y el IF no lanzaba la
--    excepción, permitiendo a un no-admin vincularse a una persona sin email.
--    COALESCE(..., false) cierra ese caso.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE persona ALTER COLUMN email DROP NOT NULL;

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
       AND NOT COALESCE(NEW.auth_user_id = auth.uid() AND lower(NEW.email) = lower(auth.email()), false)
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
    IF NOT COALESCE(
      OLD.auth_user_id IS NULL
      AND NEW.auth_user_id = auth.uid()
      AND lower(NEW.email) = lower(auth.email()),
      false
    ) AND NOT fn_es_admin() THEN
      RAISE EXCEPTION 'No tienes permiso para modificar el vinculo de cuenta de esta persona';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
