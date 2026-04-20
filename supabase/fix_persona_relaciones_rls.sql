-- ─────────────────────────────────────────────────────────────
--  FIX: persona_industria, persona_capacidad, persona_tematica
--  Ejecutar en Supabase → SQL Editor → New query → Run
--
--  Mismo patrón que fix_propuestas_rls.sql y fix_engagement_rls.sql:
--  reemplazar políticas restrictivas con acceso total para usuarios
--  autenticados, ya que estas son tablas de relaciones internas.
-- ─────────────────────────────────────────────────────────────

-- ── 1. persona_industria ──────────────────────────────────────

DROP POLICY IF EXISTS "persona_industria: ver"          ON persona_industria;
DROP POLICY IF EXISTS "persona_industria: crear"        ON persona_industria;
DROP POLICY IF EXISTS "persona_industria: eliminar"     ON persona_industria;
DROP POLICY IF EXISTS "persona_industria: acceso total" ON persona_industria;
DROP POLICY IF EXISTS "pi_select"                       ON persona_industria;
DROP POLICY IF EXISTS "pi_insert"                       ON persona_industria;
DROP POLICY IF EXISTS "pi_delete"                       ON persona_industria;

CREATE POLICY "persona_industria: acceso total"
  ON persona_industria FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 2. persona_capacidad ──────────────────────────────────────

DROP POLICY IF EXISTS "persona_capacidad: ver"          ON persona_capacidad;
DROP POLICY IF EXISTS "persona_capacidad: crear"        ON persona_capacidad;
DROP POLICY IF EXISTS "persona_capacidad: eliminar"     ON persona_capacidad;
DROP POLICY IF EXISTS "persona_capacidad: acceso total" ON persona_capacidad;
DROP POLICY IF EXISTS "pc_select"                       ON persona_capacidad;
DROP POLICY IF EXISTS "pc_insert"                       ON persona_capacidad;
DROP POLICY IF EXISTS "pc_delete"                       ON persona_capacidad;

CREATE POLICY "persona_capacidad: acceso total"
  ON persona_capacidad FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 3. persona_tematica ───────────────────────────────────────

DROP POLICY IF EXISTS "persona_tematica: ver"          ON persona_tematica;
DROP POLICY IF EXISTS "persona_tematica: crear"        ON persona_tematica;
DROP POLICY IF EXISTS "persona_tematica: eliminar"     ON persona_tematica;
DROP POLICY IF EXISTS "persona_tematica: acceso total" ON persona_tematica;
DROP POLICY IF EXISTS "pt_select"                      ON persona_tematica;
DROP POLICY IF EXISTS "pt_insert"                      ON persona_tematica;
DROP POLICY IF EXISTS "pt_delete"                      ON persona_tematica;

CREATE POLICY "persona_tematica: acceso total"
  ON persona_tematica FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
