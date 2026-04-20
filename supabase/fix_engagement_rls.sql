-- ─────────────────────────────────────────────────────────────
--  FIX: engagement y requerimiento_engagement
--  Ejecutar en Supabase → SQL Editor → New query → Run
--
--  Mismo patrón que fix_propuestas_rls.sql:
--  reemplazar políticas restrictivas con acceso total
--  para usuarios autenticados.
-- ─────────────────────────────────────────────────────────────

-- ── 1. engagement ─────────────────────────────────────────────

-- Eliminar todas las políticas existentes (nombres posibles)
DROP POLICY IF EXISTS "engagement_select"           ON engagement;
DROP POLICY IF EXISTS "engagement_insert"           ON engagement;
DROP POLICY IF EXISTS "engagement_update"           ON engagement;
DROP POLICY IF EXISTS "engagement_delete"           ON engagement;
DROP POLICY IF EXISTS "admins pueden insertar"      ON engagement;
DROP POLICY IF EXISTS "admins pueden modificar"     ON engagement;
DROP POLICY IF EXISTS "todos pueden ver"            ON engagement;
DROP POLICY IF EXISTS "engagement: acceso total"    ON engagement;
DROP POLICY IF EXISTS "proposers pueden ver"        ON engagement;
DROP POLICY IF EXISTS "engagement: ver"             ON engagement;
DROP POLICY IF EXISTS "engagement: crear"           ON engagement;
DROP POLICY IF EXISTS "engagement: editar"          ON engagement;
DROP POLICY IF EXISTS "engagement: eliminar"        ON engagement;

-- Crear política permisiva única
CREATE POLICY "engagement: acceso total"
  ON engagement FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 2. requerimiento_engagement ───────────────────────────────

DROP POLICY IF EXISTS "requerimiento_select"                ON requerimiento_engagement;
DROP POLICY IF EXISTS "requerimiento_insert"                ON requerimiento_engagement;
DROP POLICY IF EXISTS "requerimiento_update"                ON requerimiento_engagement;
DROP POLICY IF EXISTS "requerimiento_delete"                ON requerimiento_engagement;
DROP POLICY IF EXISTS "requerimiento_engagement: acceso total" ON requerimiento_engagement;
DROP POLICY IF EXISTS "reqs: ver"                          ON requerimiento_engagement;
DROP POLICY IF EXISTS "reqs: crear"                        ON requerimiento_engagement;
DROP POLICY IF EXISTS "reqs: editar"                       ON requerimiento_engagement;
DROP POLICY IF EXISTS "reqs: eliminar"                     ON requerimiento_engagement;

CREATE POLICY "requerimiento_engagement: acceso total"
  ON requerimiento_engagement FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
