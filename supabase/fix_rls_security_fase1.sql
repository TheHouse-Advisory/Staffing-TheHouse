-- ──────────────────────────────────────────────────────────────────────────────
-- fix_rls_security_fase1.sql
--
-- Diagnostico: varias tablas tenian politicas RLS "acceso total" (USING true),
-- lo que permite leer/escribir datos con solo la ANON_KEY publica, sin sesion
-- valida. Esta fase 1 exige sesion autenticada como minimo, sin cambiar
-- ninguna logica de la app (que ya exige login vía middleware).
--
-- NOTA: revisar en Supabase Studio si `persona` existe con ese nombre exacto
-- y si ya tiene RLS configurado distinto antes de correr este script.
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asignacion','propuesta_plan','asignacion_propuesta','engagement','persona']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s: acceso total" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s: solo autenticados" ON %I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', t, t);
  END LOOP;
END $$;

ALTER TABLE asignacion_historial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "historial: solo autenticados" ON asignacion_historial
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
