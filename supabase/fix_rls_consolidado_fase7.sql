-- ──────────────────────────────────────────────────────────────────────────────
-- fix_rls_consolidado_fase7.sql
--
-- Consolida RLS bajo menor privilegio. Idempotente: se puede re-ejecutar y
-- deja el estado final correcto aunque se hayan corrido scripts viejos con
-- políticas "USING (true)" (fix_propuestas_rls, create_notebook,
-- 20260512_capacity_planning, etc.) o con RLS deshabilitado
-- (fix_historial_rls, seed, 20260508_dia_critico_rls, 20260529_fix_asignacion_rls).
--
-- Matriz de acceso:
--   lectura    → usuario con persona vinculada y no suspendida (fn_tiene_acceso)
--   escritura  → admin / personas / planificador (fn_is_editor_rol)
--   persona    → además, cada usuario puede actualizar su propia fila
--                (alertas_vista_en, orden_ausencias); el trigger
--                persona_guard_acceso sigue protegiendo rol/acceso/auth_user_id
--   historial  → solo lectura; escritura únicamente vía trigger SECURITY DEFINER
--
-- No toca: anotacion*, persona_evaluacion/remuneracion*/matriz_hito/mentoria,
-- login_log, acceso_log, login_intento_ip, resumen_proyectos_log (ya estrictas).
--
-- Ejecutar en Supabase → SQL Editor. Hacer backup antes.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0. Helper: usuario con acceso real al sistema ────────────────────────────
-- auth.role() = 'authenticated' acepta cualquier cuenta de Supabase Auth
-- (p. ej. un signup no invitado). Esto exige persona vinculada y no suspendida.
CREATE OR REPLACE FUNCTION fn_tiene_acceso()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.acceso_estado IS DISTINCT FROM 'suspendida'
  );
$$;

REVOKE EXECUTE ON FUNCTION fn_tiene_acceso() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_tiene_acceso() TO authenticated;

-- ── 1. Tablas de negocio: lectura con acceso, escritura editor ───────────────
DO $$
DECLARE
  t text;
  pol record;
  tablas text[] := ARRAY[
    'asignacion','asignacion_propuesta','propuesta_plan','plan_simulacion',
    'ausencia','tipo_ausencia','capacity_planning','dia_critico',
    'engagement','engagement_actividades','engagement_capacidad',
    'engagement_extension','engagement_tematica','requerimiento_engagement',
    'historial_cargos','notebook_folder','notebook_note','anotacion_escenario',
    'cat_capacidad','cat_industria','cat_tematica','config_cargo',
    -- relaciones de persona: sin RLS en ningún script del repo
    'persona_capacidad','persona_industria','persona_tematica','persona_cargo_historial'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;  -- omite tablas inexistentes

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Borra TODAS las políticas previas (incluidas las "USING (true)")
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, t);
    END LOOP;

    EXECUTE format('CREATE POLICY "%s: lectura" ON %I FOR SELECT TO authenticated USING (fn_tiene_acceso())', t, t);
    EXECUTE format('CREATE POLICY "%s: crear editor" ON %I FOR INSERT TO authenticated WITH CHECK (fn_is_editor_rol())', t, t);
    EXECUTE format('CREATE POLICY "%s: editar editor" ON %I FOR UPDATE TO authenticated USING (fn_is_editor_rol()) WITH CHECK (fn_is_editor_rol())', t, t);
    EXECUTE format('CREATE POLICY "%s: eliminar editor" ON %I FOR DELETE TO authenticated USING (fn_is_editor_rol())', t, t);
  END LOOP;
END $$;

-- ── 2. persona: hoy "FOR ALL authenticated" (fase1) → cualquiera la edita ─────
DO $$
DECLARE pol record;
BEGIN
  ALTER TABLE persona ENABLE ROW LEVEL SECURITY;
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'persona' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON persona', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "persona: lectura" ON persona
  FOR SELECT TO authenticated USING (fn_tiene_acceso());
CREATE POLICY "persona: crear editor" ON persona
  FOR INSERT TO authenticated WITH CHECK (fn_is_editor_rol());
-- Editor edita cualquier fila; el resto solo la propia (preferencias de UI)
CREATE POLICY "persona: editar editor o propia" ON persona
  FOR UPDATE TO authenticated
  USING (fn_is_editor_rol() OR auth_user_id = auth.uid())
  WITH CHECK (fn_is_editor_rol() OR auth_user_id = auth.uid());
CREATE POLICY "persona: eliminar admin" ON persona
  FOR DELETE TO authenticated USING (fn_es_admin());

-- Quien no es editor solo puede cambiar sus preferencias de UI en su fila
CREATE OR REPLACE FUNCTION persona_solo_preferencias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  permitidas text[] := ARRAY['alertas_vista_en','orden_ausencias','updated_at','updated_by'];
BEGIN
  -- auth.uid() NULL = service_role / SQL Editor: sin restricción
  IF auth.uid() IS NULL OR fn_is_editor_rol() THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - permitidas) IS DISTINCT FROM (to_jsonb(OLD) - permitidas) THEN
    RAISE EXCEPTION 'Solo puedes modificar tus preferencias.';
  END IF;
  RETURN NEW;
END;
$$;

-- Prefijo "zz" para correr después de los demás BEFORE UPDATE (orden alfabético)
DROP TRIGGER IF EXISTS trg_persona_zz_solo_preferencias ON persona;
CREATE TRIGGER trg_persona_zz_solo_preferencias
  BEFORE UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION persona_solo_preferencias();

-- ── 3. asignacion_historial: auditoría, solo lectura desde el cliente ────────
DO $$
DECLARE pol record;
BEGIN
  ALTER TABLE asignacion_historial ENABLE ROW LEVEL SECURITY;
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'asignacion_historial' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON asignacion_historial', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "asignacion_historial: lectura" ON asignacion_historial
  FOR SELECT TO authenticated USING (fn_tiene_acceso());
-- Sin INSERT/UPDATE/DELETE: el trigger trg_historial_asignacion es SECURITY
-- DEFINER (owner) y no queda sujeto a estas políticas.

-- ── 4. Vistas: por defecto corren como owner y saltan el RLS de las tablas ───
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['cobertura_engagement','ocupacion_semana'] LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v) THEN
      EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
      EXECUTE format('REVOKE ALL ON %I FROM anon', v);
    END IF;
  END LOOP;
END $$;

-- ── 5. RPC expuestas a anon ───────────────────────────────────────────────────
-- Re-asegura el REVOKE de 20260727_restrict_login_lockout_rpc por si
-- fix_login_lockout_fase5 / fix_audit_log_fase6 se re-ejecutaron después
-- (fn_login_exitoso con anon permitía resetear el bloqueo de cualquier email).
REVOKE EXECUTE ON FUNCTION fn_verificar_bloqueo(text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_registrar_intento_fallido(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_login_exitoso(text)             FROM PUBLIC, anon, authenticated;

-- ultima_actualizacion_real no requiere acceso anónimo
REVOKE EXECUTE ON FUNCTION ultima_actualizacion_real(uuid) FROM PUBLIC, anon;

COMMIT;

-- ── 6. Verificación (ejecutar después) ───────────────────────────────────────
-- 6a. Tablas públicas SIN RLS (debe devolver 0 filas)
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;

-- 6b. Políticas abiertas restantes (debe devolver 0 filas)
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename;
