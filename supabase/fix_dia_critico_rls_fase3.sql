-- ──────────────────────────────────────────────────────────────────────────────
-- fix_dia_critico_rls_fase3.sql
--
-- Diagnostico: auditoria completa de las 28 tablas (SELECT tablename, rowsecurity
-- FROM pg_tables) mostro que dia_critico era la UNICA con RLS desactivado.
-- La migracion 20260508_dia_critico_rls.sql lo desactivo a proposito "para
-- permitir operaciones con anon key" -- pero dia_critico solo se usa dentro del
-- dashboard (ya protegido por middleware/login), igual que el resto de las
-- tablas. Se aplica el mismo patron de la Fase 1: exigir sesion autenticada.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE dia_critico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dia_critico: solo autenticados" ON dia_critico;

CREATE POLICY "dia_critico: solo autenticados"
  ON dia_critico FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
