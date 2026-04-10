-- ══════════════════════════════════════════════════════════════════════════════
-- reset.sql  —  Staffing Hub
-- ══════════════════════════════════════════════════════════════════════════════
-- Limpia TODA la data transaccional de la base de datos.
--
-- QUÉ SE PRESERVA (no se toca):
--   ✅  auth.users          — nunca modificar directamente (Supabase Auth)
--   ✅  persona             — solo el registro del admin (email configurable)
--   ✅  persona_cargo_historial — del admin, si existe
--   ✅  config_cargo        — cargos del sistema (Gerente, Consultor, etc.)
--   ✅  cat_industria       — catálogos de referencia
--   ✅  cat_capacidad
--   ✅  cat_tematica
--
-- QUÉ SE ELIMINA:
--   ❌  asignacion_historial
--   ❌  asignacion
--   ❌  asignacion_propuesta
--   ❌  propuesta_plan
--   ❌  ausencia
--   ❌  requerimiento_engagement
--   ❌  engagement
--   ❌  persona_industria, persona_capacidad, persona_tematica
--   ❌  persona_cargo_historial (de personas no-admin)
--   ❌  persona (todas menos el admin)
--
-- CÓMO USAR:
--   1. En Supabase: SQL Editor → New query → pegar este script → Run
--   2. Ajusta el EMAIL_ADMIN si es necesario
--   3. Ejecutar DESPUÉS de fix_historial_rls.sql (si aún no lo has hecho)
--
-- ⚠️  IRREVERSIBLE — hacer snapshot/backup antes si es necesario
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
--  Configuración: email del usuario admin a preservar
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  admin_email CONSTANT text := 'sdelano@thehouse.cl';  -- ← ajustar si es diferente
  admin_persona_id uuid;
BEGIN
  SELECT id INTO admin_persona_id FROM persona WHERE email = admin_email LIMIT 1;
  RAISE NOTICE 'Admin persona_id: %', COALESCE(admin_persona_id::text, 'NO ENCONTRADO — se eliminará todo');
END $$;


-- ─────────────────────────────────────────────────────────────
--  1. Historial de asignaciones (depende de asignacion)
-- ─────────────────────────────────────────────────────────────
DELETE FROM asignacion_historial;

-- ─────────────────────────────────────────────────────────────
--  2. Asignaciones confirmadas
-- ─────────────────────────────────────────────────────────────
DELETE FROM asignacion;

-- ─────────────────────────────────────────────────────────────
--  3. Propuestas de asignación y planes
--     (asignacion_propuesta tiene ON DELETE CASCADE desde propuesta_plan,
--      pero las borramos explícitamente para claridad)
-- ─────────────────────────────────────────────────────────────
DELETE FROM asignacion_propuesta;
DELETE FROM propuesta_plan;

-- ─────────────────────────────────────────────────────────────
--  4. Ausencias / licencias
-- ─────────────────────────────────────────────────────────────
DELETE FROM ausencia;

-- ─────────────────────────────────────────────────────────────
--  5. Requerimientos de engagement (dependen de engagement)
-- ─────────────────────────────────────────────────────────────
DELETE FROM requerimiento_engagement;

-- ─────────────────────────────────────────────────────────────
--  6. Engagements
--     (propuesta_origen_id es self-reference, NULL primero no es problema
--      porque ON DELETE SET NULL o CASCADE según schema)
-- ─────────────────────────────────────────────────────────────
DELETE FROM engagement;

-- ─────────────────────────────────────────────────────────────
--  7. Relaciones de persona (industrias, capacidades, temáticas)
--     Solo de personas no-admin
-- ─────────────────────────────────────────────────────────────
DELETE FROM persona_industria
WHERE persona_id NOT IN (
  SELECT id FROM persona WHERE email = 'sdelano@thehouse.cl'
);

DELETE FROM persona_capacidad
WHERE persona_id NOT IN (
  SELECT id FROM persona WHERE email = 'sdelano@thehouse.cl'
);

DELETE FROM persona_tematica
WHERE persona_id NOT IN (
  SELECT id FROM persona WHERE email = 'sdelano@thehouse.cl'
);

-- ─────────────────────────────────────────────────────────────
--  8. Historial de cargo de personas no-admin
-- ─────────────────────────────────────────────────────────────
DELETE FROM persona_cargo_historial
WHERE persona_id NOT IN (
  SELECT id FROM persona WHERE email = 'sdelano@thehouse.cl'
);

-- ─────────────────────────────────────────────────────────────
--  9. Personas — eliminar todas EXCEPTO el admin
-- ─────────────────────────────────────────────────────────────
DELETE FROM persona
WHERE email != 'sdelano@thehouse.cl';

COMMIT;

-- ─────────────────────────────────────────────────────────────
--  Verificación final
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM persona)                  AS personas_restantes,
  (SELECT COUNT(*) FROM engagement)               AS engagements,
  (SELECT COUNT(*) FROM requerimiento_engagement) AS requerimientos,
  (SELECT COUNT(*) FROM asignacion)               AS asignaciones,
  (SELECT COUNT(*) FROM propuesta_plan)           AS planes,
  (SELECT COUNT(*) FROM config_cargo)             AS cargos_config,
  (SELECT COUNT(*) FROM cat_industria)            AS industrias;
-- Esperado: personas=1 (admin), todo lo demás = 0, config_cargo e industrias > 0
