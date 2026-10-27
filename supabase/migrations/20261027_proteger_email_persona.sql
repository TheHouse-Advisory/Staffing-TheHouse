-- ──────────────────────────────────────────────────────────────────────────────
-- Protege columnas de persona usadas por el login y las invitaciones.
--
-- Antes: un planificador (editor) podía cambiar el email de una persona con
-- acceso. Las invitaciones y confirmarCuenta() vinculan la cuenta por email,
-- así que podía redirigir la invitación de un admin a su propio correo y
-- quedarse con ese acceso. También podía resetear el bloqueo por intentos
-- fallidos (intentos_fallidos / bloqueado_hasta).
--
-- Ahora, solo admin/personas (o el servidor con service_role) pueden:
--   · cambiar el email de una persona que tiene o tuvo acceso al sistema
--   · modificar intentos_fallidos / bloqueado_hasta
-- El email de personas sin acceso (solo recurso de staffing) sigue editable.
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION persona_guard_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() NULL = service_role / SQL Editor: sin restricción
  IF auth.uid() IS NULL OR fn_es_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email
     AND (OLD.rol_sistema IS NOT NULL OR OLD.auth_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el email de una persona con acceso al sistema.';
  END IF;

  IF NEW.intentos_fallidos IS DISTINCT FROM OLD.intentos_fallidos
     OR NEW.bloqueado_hasta IS DISTINCT FROM OLD.bloqueado_hasta THEN
    RAISE EXCEPTION 'Solo un administrador puede modificar el bloqueo de inicio de sesión.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_persona_guard_email ON persona;
CREATE TRIGGER trg_persona_guard_email
  BEFORE UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION persona_guard_email();
