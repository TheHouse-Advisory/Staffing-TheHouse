-- ══════════════════════════════════════════════════════════════════════════════
-- plan_simulacion_approval.sql — Staffing Hub
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Agrega columna data_real_previa a plan_simulacion (snapshot pre-aprobación)
-- 2. RPC aprobar_plan_simulacion  → snapshot real → aplica simulado → Aceptado
-- 3. RPC deshacer_aprobacion_plan → restaura real previo → Borrador
--
-- CÓMO USAR: Supabase → SQL Editor → New query → pegar → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Columna de snapshot pre-aprobación ─────────────────────────────────────
ALTER TABLE plan_simulacion
  ADD COLUMN IF NOT EXISTS data_real_previa JSONB DEFAULT NULL;

-- ── 2. RPC: Aprobar plan ──────────────────────────────────────────────────────
-- Pasos atómicos:
--   A. Captura todas las asignaciones activas actuales → data_real_previa
--   B. Elimina asignaciones activas actuales (estado='activa')
--   C. Inserta las asignaciones derivadas de data_simulada
--   D. Cambia estado del plan a 'Aceptado'
CREATE OR REPLACE FUNCTION aprobar_plan_simulacion(p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_data_simulada JSONB;
  v_snapshot_real JSONB;
  v_eng           JSONB;
  v_persona       JSONB;
BEGIN
  -- Leer data_simulada del plan
  SELECT data_simulada INTO v_data_simulada
  FROM plan_simulacion WHERE id = p_plan_id;

  IF v_data_simulada IS NULL THEN
    RAISE EXCEPTION 'Plan % no encontrado o sin data_simulada', p_plan_id;
  END IF;

  -- A: Snapshot de asignaciones reales actuales
  SELECT jsonb_agg(row_to_json(a)::jsonb)
  INTO v_snapshot_real
  FROM asignacion a WHERE a.estado = 'activa';

  -- Guardar snapshot real en el plan
  UPDATE plan_simulacion
  SET data_real_previa = COALESCE(v_snapshot_real, '[]'::jsonb)
  WHERE id = p_plan_id;

  -- B: Eliminar asignaciones activas reales
  DELETE FROM asignacion WHERE estado = 'activa';

  -- C: Insertar asignaciones desde data_simulada
  FOR v_eng IN SELECT * FROM jsonb_array_elements(v_data_simulada)
  LOOP
    FOR v_persona IN SELECT * FROM jsonb_array_elements(v_eng->'personas')
    LOOP
      INSERT INTO asignacion (
        engagement_id,
        persona_id,
        cargo_al_momento,
        pct_dedicacion,
        fecha_inicio,
        fecha_fin,
        estado,
        estado_staffing,
        requerimiento_id
      ) VALUES (
        (v_eng->>'id')::uuid,
        (v_persona->>'id')::uuid,
        v_persona->>'cargo',
        (v_persona->>'pct')::numeric,
        (v_persona->>'fecha_inicio')::date,
        (v_persona->>'fecha_fin')::date,
        'activa',
        'CONFIRMADO',
        NULL  -- la simulación no preserva req_id
      );
    END LOOP;
  END LOOP;

  -- D: Marcar plan como Aceptado
  UPDATE plan_simulacion SET estado = 'Aceptado' WHERE id = p_plan_id;

  RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id);
EXCEPTION WHEN OTHERS THEN
  -- Rollback automático por ser PLPGSQL transaccional
  RAISE;
END;
$$;

-- ── 3. RPC: Deshacer aprobación ───────────────────────────────────────────────
-- Pasos atómicos:
--   A. Lee data_real_previa del plan
--   B. Elimina asignaciones activas actuales
--   C. Restaura las asignaciones desde data_real_previa
--   D. Cambia estado del plan a 'Borrador'
CREATE OR REPLACE FUNCTION deshacer_aprobacion_plan(p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_data_real_previa JSONB;
  v_asig             JSONB;
BEGIN
  -- Leer snapshot real previo
  SELECT data_real_previa INTO v_data_real_previa
  FROM plan_simulacion WHERE id = p_plan_id;

  IF v_data_real_previa IS NULL THEN
    RAISE EXCEPTION 'Plan % no tiene snapshot de data_real_previa. No se puede deshacer.', p_plan_id;
  END IF;

  -- A: Eliminar asignaciones activas actuales (las del plan aprobado)
  DELETE FROM asignacion WHERE estado = 'activa';

  -- B: Restaurar asignaciones reales previas
  FOR v_asig IN SELECT * FROM jsonb_array_elements(v_data_real_previa)
  LOOP
    INSERT INTO asignacion (
      id,
      engagement_id,
      persona_id,
      requerimiento_id,
      cargo_al_momento,
      pct_dedicacion,
      fecha_inicio,
      fecha_fin,
      estado,
      estado_staffing,
      created_at
    ) VALUES (
      (v_asig->>'id')::uuid,
      (v_asig->>'engagement_id')::uuid,
      (v_asig->>'persona_id')::uuid,
      CASE WHEN v_asig->>'requerimiento_id' IS NULL THEN NULL
           ELSE (v_asig->>'requerimiento_id')::uuid END,
      v_asig->>'cargo_al_momento',
      (v_asig->>'pct_dedicacion')::numeric,
      (v_asig->>'fecha_inicio')::date,
      (v_asig->>'fecha_fin')::date,
      COALESCE(v_asig->>'estado', 'activa'),
      COALESCE(v_asig->>'estado_staffing', 'CONFIRMADO'),
      COALESCE((v_asig->>'created_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- C: Regresar estado del plan a Borrador
  UPDATE plan_simulacion
  SET estado = 'Borrador', data_real_previa = NULL
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('ok', true, 'plan_id', p_plan_id);
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ── Permisos ──────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION aprobar_plan_simulacion(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION deshacer_aprobacion_plan(TEXT) TO authenticated;

-- ── Verificación ──────────────────────────────────────────────────────────────
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('aprobar_plan_simulacion', 'deshacer_aprobacion_plan');
