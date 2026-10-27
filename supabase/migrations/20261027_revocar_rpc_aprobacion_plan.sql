-- ──────────────────────────────────────────────────────────────────────────────
-- Cierra las RPC aprobar_plan_simulacion / deshacer_aprobacion_plan.
--
-- La app ya no las usa (GanttPlanificacion aprueba y deshace con escrituras
-- directas, sujetas a RLS de editor). Seguían expuestas como SECURITY DEFINER:
-- un usuario con rol 'proposer' podía llamarlas directo, saltarse RLS y
-- borrar todas las asignaciones activas (aprobar dos veces o deshacer un plan
-- antiguo restauraba un respaldo viejo y perdía los cambios posteriores).
--
-- Solo quedan disponibles para service_role (SQL Editor / scripts admin).
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION aprobar_plan_simulacion(TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION deshacer_aprobacion_plan(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION aprobar_plan_simulacion(TEXT)  TO service_role;
GRANT  EXECUTE ON FUNCTION deshacer_aprobacion_plan(TEXT) TO service_role;

-- Verificación: no debe aparecer 'authenticated' ni 'anon' ni 'PUBLIC'
SELECT routine_name, grantee
FROM information_schema.routine_privileges
WHERE routine_name IN ('aprobar_plan_simulacion', 'deshacer_aprobacion_plan')
ORDER BY routine_name, grantee;
