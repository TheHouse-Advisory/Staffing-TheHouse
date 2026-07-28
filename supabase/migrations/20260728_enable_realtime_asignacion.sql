-- ──────────────────────────────────────────────────────────────────────────────
-- 20260728_enable_realtime_asignacion.sql
--
-- Habilita Supabase Realtime (postgres_changes) sobre la tabla `asignacion`,
-- usado por ResumenProyectosClient.tsx para refrescar la vista automáticamente
-- cuando otro usuario edita una celda de asignación. Incluido en el plan de
-- Supabase (free y de pago), sin costo aparte.
-- ──────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table asignacion;
