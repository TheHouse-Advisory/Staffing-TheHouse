-- ──────────────────────────────────────────────────────────────────────────────
-- fix_write_permissions_fase4.sql
--
-- Restringe escritura (INSERT/UPDATE/DELETE) en tablas de negocio, notebook y
-- catalogos a roles 'admin' y 'planificador'. Los roles 'GyD', 'A&Sr' y
-- 'Desarrollo' quedan en solo-lectura (SELECT) a nivel de RLS en estas tablas.
--
-- No incluye `persona` ni sus tablas relacionadas (persona_capacidad,
-- persona_cargo_historial, persona_industria, persona_tematica): no fueron
-- parte de esta solicitud y ya tienen su propio guard (persona_guard_acceso).
--
-- Se eliminan TODAS las politicas previas de cada tabla (dinamicamente, via
-- pg_policies) antes de crear las nuevas, para evitar que una politica vieja
-- "FOR ALL" deje sin efecto la restriccion.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_is_editor_rol()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'planificador')
  );
$$;

DO $$
DECLARE
  t text;
  pol record;
  tablas text[] := ARRAY[
    'asignacion','asignacion_historial','asignacion_propuesta','ausencia',
    'capacity_planning','dia_critico','engagement','engagement_actividades',
    'engagement_capacidad','engagement_extension','engagement_tematica',
    'historial_cargos','notebook_folder','notebook_note','plan_simulacion',
    'propuesta_plan','requerimiento_engagement','anotacion_escenario',
    'cat_capacidad','cat_industria','cat_tematica','config_cargo','tipo_ausencia'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY "%s: lectura autenticados" ON %I FOR SELECT USING (auth.role() = ''authenticated'')',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s: crear admin/planificador" ON %I FOR INSERT WITH CHECK (fn_is_editor_rol())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s: editar admin/planificador" ON %I FOR UPDATE USING (fn_is_editor_rol()) WITH CHECK (fn_is_editor_rol())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "%s: eliminar admin/planificador" ON %I FOR DELETE USING (fn_is_editor_rol())',
      t, t
    );
  END LOOP;
END $$;
