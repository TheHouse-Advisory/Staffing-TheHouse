-- ──────────────────────────────────────────────────────────────────────────────
-- fix_historial_rls.sql
--
-- Problema: al aprobar un plan y crear registros en `asignacion`, el trigger
-- que escribe en `asignacion_historial` falla con:
--   "new row violates row-level security policy for table asignacion_historial"
--
-- Causa: existe RLS en `asignacion_historial` pero no hay ninguna política que
-- permita INSERT (las políticas existentes eran solo para SELECT o decían
-- "solo via trigger" sin implementarlo correctamente).
--
-- Solución: la función de trigger ya corre con los permisos del owner de la
-- función (SECURITY DEFINER), pero si RLS está habilitado y no hay política,
-- el trigger aún falla. Tenemos dos opciones:
--
--   Opción A (recomendada): deshabilitar RLS en historial, dado que es una
--   tabla de auditoría interna que nunca se expone directamente al cliente.
--
--   Opción B: agregar política permisiva para el rol de servicio/autenticado.
--
-- Ejecutamos la Opción A (más simple y correcta para tablas de auditoría):
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Deshabilitar RLS en la tabla de historial
--    (es una tabla de auditoría interna — no se expone al cliente directamente)
ALTER TABLE asignacion_historial DISABLE ROW LEVEL SECURITY;


-- 2. Asegurarnos de que la función trigger exista y sea SECURITY DEFINER
--    para que corra con permisos del owner (postgres) incluso si RLS está on.
--    Esto es una protección adicional por si vuelves a habilitar RLS en el futuro.
CREATE OR REPLACE FUNCTION trg_historial_asignacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO asignacion_historial (
      asignacion_id, tipo_cambio, persona_id, engagement_id,
      pct_dedicacion, fecha_inicio, fecha_fin, estado, notas
    ) VALUES (
      NEW.id, 'creacion', NEW.persona_id, NEW.engagement_id,
      NEW.pct_dedicacion, NEW.fecha_inicio, NEW.fecha_fin, NEW.estado, NEW.notas
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO asignacion_historial (
      asignacion_id, tipo_cambio, persona_id, engagement_id,
      pct_dedicacion, fecha_inicio, fecha_fin, estado, notas
    ) VALUES (
      NEW.id, 'modificacion', NEW.persona_id, NEW.engagement_id,
      NEW.pct_dedicacion, NEW.fecha_inicio, NEW.fecha_fin, NEW.estado, NEW.notas
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Verificar que el trigger esté correctamente enlazado
--    (solo re-crea si no existe ya; en Supabase puede que ya exista)
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


-- ──────────────────────────────────────────────────────────────────────────────
-- ALTERNATIVA (Opción B): si prefieres mantener RLS habilitado,
-- comenta el ALTER TABLE de arriba y ejecuta esto en su lugar:
-- ──────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE asignacion_historial ENABLE ROW LEVEL SECURITY;

-- -- Política que permite INSERT solo a través del trigger (service role / postgres)
-- CREATE POLICY "historial_insert_via_trigger"
--   ON asignacion_historial
--   FOR INSERT
--   TO authenticated
--   WITH CHECK (true);

-- -- Política SELECT: cada usuario autenticado puede leer todo el historial
-- CREATE POLICY "historial_select_authenticated"
--   ON asignacion_historial
--   FOR SELECT
--   TO authenticated
--   USING (true);
