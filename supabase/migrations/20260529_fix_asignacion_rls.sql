-- ──────────────────────────────────────────────────────────────────────────────
-- fix_asignacion_rls.sql
--
-- Problema: el UPDATE en la tabla `asignacion` falla con error vacío {} desde
-- el cliente browser (anon key). Causas posibles:
--   1. RLS habilitado en `asignacion` sin política de UPDATE → silencia el write
--   2. Trigger `trg_historial_asignacion` sin SECURITY DEFINER → falla al
--      insertar en `asignacion_historial` y hace rollback del UPDATE completo
--
-- Solución: política acceso total (sistema interno sin auth) + trigger robusto
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Asegurar que RLS está habilitado pero con política abierta (acceso total)
--    Mismo patrón que propuesta_plan, asignacion_propuesta, engagement, etc.
ALTER TABLE asignacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "asignacion: acceso total"  ON asignacion;
DROP POLICY IF EXISTS "asig: ver"                 ON asignacion;
DROP POLICY IF EXISTS "asig: crear"               ON asignacion;
DROP POLICY IF EXISTS "asig: editar"              ON asignacion;
DROP POLICY IF EXISTS "asig: eliminar"            ON asignacion;

CREATE POLICY "asignacion: acceso total"
  ON asignacion FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Asegurar que asignacion_historial no bloquea los INSERTs del trigger
ALTER TABLE asignacion_historial DISABLE ROW LEVEL SECURITY;

-- 3. Recrear trigger como SECURITY DEFINER para que siempre corra con permisos
--    del owner (postgres), independientemente del rol que ejecute el DML.
--    También usamos EXCEPTION para que un fallo en el historial NO haga
--    rollback del UPDATE principal (el historial es auditoría, no crítico).
CREATE OR REPLACE FUNCTION trg_historial_asignacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO asignacion_historial (
        asignacion_id, tipo_cambio, persona_id, engagement_id,
        pct_dedicacion, fecha_inicio, fecha_fin, estado, notas
      ) VALUES (
        NEW.id, 'creacion', NEW.persona_id, NEW.engagement_id,
        NEW.pct_dedicacion, NEW.fecha_inicio, NEW.fecha_fin,
        NEW.estado, NEW.notas
      );
    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO asignacion_historial (
        asignacion_id, tipo_cambio, persona_id, engagement_id,
        pct_dedicacion, fecha_inicio, fecha_fin, estado, notas
      ) VALUES (
        NEW.id, 'modificacion', NEW.persona_id, NEW.engagement_id,
        NEW.pct_dedicacion, NEW.fecha_inicio, NEW.fecha_fin,
        NEW.estado, NEW.notas
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- El historial es auditoría: si falla, loguea pero no bloquea el DML principal
    RAISE WARNING 'trg_historial_asignacion: no se pudo registrar historial: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 4. Vincular trigger si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_historial_asignacion'
      AND tgrelid = 'asignacion'::regclass
  ) THEN
    CREATE TRIGGER trg_historial_asignacion
      AFTER INSERT OR UPDATE ON asignacion
      FOR EACH ROW EXECUTE FUNCTION trg_historial_asignacion();
  END IF;
END;
$$;
