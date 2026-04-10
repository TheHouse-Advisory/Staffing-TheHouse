-- ─────────────────────────────────────────────────────────────
--  FIX: propuesta_plan y asignacion_propuesta
--  Ejecutar en Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────

-- ── 1. propuesta_plan ─────────────────────────────────────────

-- Eliminar la FK de creada_por (sistema interno sin auth, no es necesaria)
ALTER TABLE propuesta_plan
  DROP CONSTRAINT IF EXISTS propuesta_plan_creada_por_fkey;

-- Reemplazar políticas RLS con acceso total (sistema interno)
DROP POLICY IF EXISTS "planes: ver todos"   ON propuesta_plan;
DROP POLICY IF EXISTS "planes: crear"       ON propuesta_plan;
DROP POLICY IF EXISTS "planes: actualizar"  ON propuesta_plan;
DROP POLICY IF EXISTS "planes: acceso total" ON propuesta_plan;

CREATE POLICY "planes: acceso total"
  ON propuesta_plan FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 2. asignacion_propuesta ───────────────────────────────────

-- Hacer propuesto_por nullable (no hay usuario autenticado en este sistema)
ALTER TABLE asignacion_propuesta
  ALTER COLUMN propuesto_por DROP NOT NULL;

-- Reemplazar políticas RLS con acceso total
DROP POLICY IF EXISTS prop_select          ON asignacion_propuesta;
DROP POLICY IF EXISTS prop_insert          ON asignacion_propuesta;
DROP POLICY IF EXISTS prop_update_own      ON asignacion_propuesta;
DROP POLICY IF EXISTS "prop: ver"          ON asignacion_propuesta;
DROP POLICY IF EXISTS "prop: crear"        ON asignacion_propuesta;
DROP POLICY IF EXISTS "prop: editar"       ON asignacion_propuesta;
DROP POLICY IF EXISTS "asig_propuesta: acceso total" ON asignacion_propuesta;

CREATE POLICY "asig_propuesta: acceso total"
  ON asignacion_propuesta FOR ALL
  USING (true)
  WITH CHECK (true);
