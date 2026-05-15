-- ════════════════════════════════════════════════════════════════════════
--  Separar la gestión de ACCESO AL SISTEMA de la creación de personas.
--
--  Problema anterior:
--    El constraint "rol_requiere_auth" exigía que toda persona con
--    rol_sistema tuviera además auth_user_id. Es decir, no se podía
--    asignar un rol sin que la cuenta de login ya existiera → crear una
--    persona con rol asignado fallaba con un error de check constraint.
--
--  Modelo nuevo:
--    · Una persona puede existir sin rol ni cuenta (solo recurso de staffing).
--    · El rol y el acceso se gestionan aparte, desde la página /accesos.
--    · acceso_estado rastrea el ciclo de vida del acceso al sistema.
--    · Solo un admin puede modificar rol_sistema o acceso_estado (trigger).
--
--  ⚠️  Ejecutar en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
--  1. Eliminar el constraint que acoplaba rol y cuenta de login.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE persona DROP CONSTRAINT IF EXISTS rol_requiere_auth;

-- ─────────────────────────────────────────────────────────────
--  2. Estado del acceso al sistema.
--       NULL        → la persona no tiene acceso (no aparece en /accesos)
--       'invitada'  → invitación enviada, falta definir contraseña
--       'activa'    → la persona ya definió su contraseña / tiene acceso
--       'suspendida'→ un admin desactivó el acceso (conserva el rol)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS acceso_estado TEXT;

ALTER TABLE persona DROP CONSTRAINT IF EXISTS persona_acceso_estado_check;
ALTER TABLE persona
  ADD CONSTRAINT persona_acceso_estado_check
  CHECK (acceso_estado IS NULL OR acceso_estado IN ('invitada', 'activa', 'suspendida'));

-- ─────────────────────────────────────────────────────────────
--  3. Backfill de datos existentes.
--     Las personas que hoy ya tienen rol tenían (por el viejo
--     constraint) una cuenta funcionando → quedan como 'activa'.
--     Si por algún motivo hay estado sin rol, se limpia.
-- ─────────────────────────────────────────────────────────────
UPDATE persona
   SET acceso_estado = 'activa'
 WHERE rol_sistema IS NOT NULL
   AND acceso_estado IS NULL;

UPDATE persona
   SET acceso_estado = NULL
 WHERE rol_sistema IS NULL
   AND acceso_estado IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
--  4. Guard a nivel de base de datos.
--     Solo un admin puede modificar rol_sistema o acceso_estado.
--     Las server actions usan el service_role (auth.uid() = NULL),
--     por lo que pasan el guard; cualquier cliente con sesión de
--     usuario debe ser admin. Esto cierra la escalada de privilegios
--     aunque alguien llame a la API REST directamente.
-- ─────────────────────────────────────────────────────────────
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
    IF NEW.rol_sistema IS NOT NULL OR NEW.acceso_estado IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM persona p
        WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
      ) THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar accesos al sistema';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: solo se valida si cambian las columnas de acceso.
  IF NEW.rol_sistema   IS DISTINCT FROM OLD.rol_sistema
  OR NEW.acceso_estado IS DISTINCT FROM OLD.acceso_estado THEN
    IF NOT EXISTS (
      SELECT 1 FROM persona p
      WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
    ) THEN
      RAISE EXCEPTION 'Solo un administrador puede modificar accesos al sistema';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_persona_guard_acceso ON persona;
CREATE TRIGGER trg_persona_guard_acceso
  BEFORE INSERT OR UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION persona_guard_acceso();

COMMIT;
