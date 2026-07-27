-- ──────────────────────────────────────────────────────────────────────────────
-- 20260727_fix_persona_and_plan_approval_privesc.sql
--
-- Corrige dos hallazgos CRÍTICOS de una auditoría de seguridad:
--
-- 1. persona_guard_acceso() solo protegía rol_sistema/acceso_estado, pero NO
--    auth_user_id. Como la política RLS de `persona` (fix_rls_security_fase1.sql)
--    solo exige `auth.role() = 'authenticated'`, cualquier usuario logueado con
--    CUALQUIER rol podía ejecutar, directo contra la API REST (sin pasar por la
--    UI):
--      supabase.from('persona').update({ auth_user_id: MI_UID }).eq('id', ID_DE_UN_ADMIN)
--    y en su próximo login el sistema lo trataría como si fuera esa persona
--    (incluido su rol admin) — escalada de privilegios total / robo de cuenta.
--    Fix: el trigger ahora también protege auth_user_id. Solo se permite que
--    un usuario SIN rol admin lo cambie en un caso: el auto-vínculo legítimo
--    del primer login (fila aún sin auth_user_id, y el usuario vincula SU
--    PROPIO uid a una fila cuyo email coincide con el suyo — el mismo caso
--    que ya hace lib/auth.ts:requireAuth()). Cualquier otro cambio requiere
--    ser admin (o service_role, ya cubierto por el `auth.uid() IS NULL`
--    existente).
--
-- 2. aprobar_plan_simulacion / deshacer_aprobacion_plan (plan_simulacion_approval.sql)
--    son SECURITY DEFINER sin ningún chequeo de rol y sin `SET search_path`,
--    otorgadas a `authenticated`. Como SECURITY DEFINER se salta el RLS de
--    `asignacion`/`plan_simulacion` (que fase4 restringió a admin), cualquier
--    usuario autenticado con cualquier rol podía borrar TODAS las asignaciones
--    activas de la empresa y reemplazarlas por datos de una simulación, o
--    deshacer una aprobación real. Fix: se agrega un chequeo de rol dedicado
--    (fn_puede_aprobar_plan(), admin + proposer) y se fija SET search_path = public.
--    NO se reutiliza fn_is_editor_rol() (fase4) a propósito: esa función la
--    usan ~20 tablas de negocio más (asignacion, ausencia, engagement,
--    capacity_planning, notebook, catálogos, etc.) — agregarle 'proposer' ahí
--    le daría a ese rol escritura en todas esas tablas, no solo permiso para
--    aprobar/deshacer un plan de simulación.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. persona_guard_acceso(): agregar protección de auth_user_id ────────────
CREATE OR REPLACE FUNCTION persona_guard_acceso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / SQL Editor → no hay usuario → operación permitida.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.rol_sistema IS NOT NULL OR NEW.acceso_estado IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM persona p
        WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
      ) THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar accesos al sistema';
      END IF;
    END IF;

    IF NEW.auth_user_id IS NOT NULL
       AND NOT (NEW.auth_user_id = auth.uid() AND lower(NEW.email) = lower(auth.email())) THEN
      IF NOT EXISTS (
        SELECT 1 FROM persona p
        WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
      ) THEN
        RAISE EXCEPTION 'No tienes permiso para vincular esta persona a una cuenta';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: rol_sistema / acceso_estado (igual que antes).
  IF NEW.rol_sistema   IS DISTINCT FROM OLD.rol_sistema
  OR NEW.acceso_estado IS DISTINCT FROM OLD.acceso_estado THEN
    IF NOT EXISTS (
      SELECT 1 FROM persona p
      WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
    ) THEN
      RAISE EXCEPTION 'Solo un administrador puede modificar accesos al sistema';
    END IF;
  END IF;

  -- UPDATE: auth_user_id (nuevo). Único caso permitido para no-admin: la fila
  -- no tenía dueño y el usuario se vincula a SÍ MISMO en una fila con su mismo email.
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    IF NOT (
      OLD.auth_user_id IS NULL
      AND NEW.auth_user_id = auth.uid()
      AND lower(NEW.email) = lower(auth.email())
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM persona p
        WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'
      ) THEN
        RAISE EXCEPTION 'No tienes permiso para modificar el vinculo de cuenta de esta persona';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Chequeo dedicado: admin o proposer pueden aprobar/deshacer un plan ────
CREATE OR REPLACE FUNCTION fn_puede_aprobar_plan()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM persona p
    WHERE p.auth_user_id = auth.uid()
      AND p.rol_sistema IN ('admin', 'proposer')
  );
$$;

CREATE OR REPLACE FUNCTION aprobar_plan_simulacion(p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_simulada JSONB;
  v_snapshot_real JSONB;
  v_eng           JSONB;
  v_persona       JSONB;
BEGIN
  IF NOT fn_puede_aprobar_plan() THEN
    RAISE EXCEPTION 'No tienes permiso para aprobar un plan de simulacion';
  END IF;

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
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION deshacer_aprobacion_plan(p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_real_previa JSONB;
  v_asig             JSONB;
BEGIN
  IF NOT fn_puede_aprobar_plan() THEN
    RAISE EXCEPTION 'No tienes permiso para deshacer la aprobacion de un plan';
  END IF;

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
