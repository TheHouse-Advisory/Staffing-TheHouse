-- ──────────────────────────────────────────────────────────────────────────────
-- fix_roles_security_fase2.sql
--
-- ⚠ NO EJECUTAR — REDUNDANTE.
-- Auditoria (2026-07-23) confirmo que persona ya tiene el trigger
-- trg_persona_guard_acceso (funcion persona_guard_acceso) que cubre esto mismo
-- y mas: bloquea cambios de rol_sistema Y acceso_estado por no-admins, tanto en
-- INSERT como en UPDATE. Se deja este archivo solo como referencia del
-- diagnostico original; no aplicar.
--
-- Diagnostico: el cambio de rol se hacia con un UPDATE directo a `persona`
-- desde el navegador (AccesosManager.tsx), protegido solo por la politica RLS
-- "solo autenticados" de la Fase 1. Cualquier usuario logueado (no solo admin)
-- podia llamar esa misma escritura por API y auto-promoverse a admin.
--
-- Nota: RLS (USING/WITH CHECK) no puede comparar el valor ANTERIOR vs el NUEVO
-- de una sola columna en un UPDATE, por eso el blindaje de columna se hace con
-- un trigger BEFORE UPDATE (equivalente a RLS a nivel de columna).
--
-- auth.uid() IS NULL = contexto service_role (server actions ya protegidos con
-- requireAdmin() antes de llegar aqui, ej. otorgarAcceso) -> se confia en ese
-- contexto, igual que el resto de la app.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_rol_sistema_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mi_rol text;
BEGIN
  IF NEW.rol_sistema IS DISTINCT FROM OLD.rol_sistema THEN
    IF auth.uid() IS NOT NULL THEN
      SELECT rol_sistema::text INTO mi_rol
      FROM persona
      WHERE auth_user_id = auth.uid();

      IF mi_rol IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede modificar el rol de sistema.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_rol_sistema_update ON persona;
CREATE TRIGGER trg_check_rol_sistema_update
  BEFORE UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION fn_check_rol_sistema_update();
