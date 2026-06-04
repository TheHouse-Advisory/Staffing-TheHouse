-- ══════════════════════════════════════════════════════════════════════════════
-- create_plan_simulacion.sql — Staffing Hub
-- ══════════════════════════════════════════════════════════════════════════════
-- Crea la tabla `plan_simulacion` para persistir escenarios de planificación.
-- Los datos reales de asignaciones NO se tocan jamás desde esta tabla.
--
-- CÓMO USAR: Supabase → SQL Editor → New query → pegar → Run
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plan_simulacion (
  id           TEXT        PRIMARY KEY,           -- generado en frontend: "plan_<timestamp>"
  nombre       TEXT        NOT NULL,
  estado       TEXT        NOT NULL DEFAULT 'Borrador'
                           CHECK (estado IN ('Borrador', 'Aceptado', 'Rechazado')),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- JSON del estado simulado (engagements + personas modificadas).
  -- NUNCA se mezcla con las tablas reales de asignacion/engagement.
  data_simulada JSONB      DEFAULT '[]'::jsonb
);

-- RLS: cada usuario ve y edita solo sus propios planes
ALTER TABLE plan_simulacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_simulacion_select" ON plan_simulacion
  FOR SELECT TO authenticated
  USING (creado_por = auth.uid() OR creado_por IS NULL);

CREATE POLICY "plan_simulacion_insert" ON plan_simulacion
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "plan_simulacion_update" ON plan_simulacion
  FOR UPDATE TO authenticated
  USING (creado_por = auth.uid() OR creado_por IS NULL);

CREATE POLICY "plan_simulacion_delete" ON plan_simulacion
  FOR DELETE TO authenticated
  USING (creado_por = auth.uid() OR creado_por IS NULL);

-- Índice para listar planes del usuario actual rápido
CREATE INDEX IF NOT EXISTS idx_plan_simulacion_creado_por ON plan_simulacion(creado_por);

-- Verificación
SELECT id, nombre, estado, creado_en FROM plan_simulacion ORDER BY creado_en DESC;
