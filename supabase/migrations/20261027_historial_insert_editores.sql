-- ──────────────────────────────────────────────────────────────────────────────
-- Corrige regresión de 20261027_0_rls_consolidado.sql (fase 7).
--
-- Fase 7 dejó asignacion_historial sin política de INSERT, asumiendo que los
-- triggers SECURITY DEFINER no quedan sujetos a RLS. En este proyecto sí lo
-- están (el dueño de la función no es dueño de la tabla), así que crear o
-- modificar una asignación fallaba con:
--   new row violates row-level security policy for table "asignacion_historial"
--
-- Se permite INSERT a los editores (los únicos que pueden crear/modificar
-- asignaciones). Sigue sin haber UPDATE/DELETE: el historial no se puede
-- alterar ni borrar desde la app.
-- Lo mismo para asignacion_eliminada_log (su trigger atrapa el error, así que
-- los borrados funcionaban pero no quedaban registrados).
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "asignacion_historial: crear editor" ON asignacion_historial;
CREATE POLICY "asignacion_historial: crear editor" ON asignacion_historial
  FOR INSERT TO authenticated WITH CHECK (fn_is_editor_rol());

DROP POLICY IF EXISTS "asignacion_eliminada_log: crear editor" ON asignacion_eliminada_log;
CREATE POLICY "asignacion_eliminada_log: crear editor" ON asignacion_eliminada_log
  FOR INSERT TO authenticated WITH CHECK (fn_is_editor_rol());
