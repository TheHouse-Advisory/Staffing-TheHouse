-- ──────────────────────────────────────────────────────────────────────────────
-- Línea temporal de remuneraciones (hitos: cambios de sueldo por persona).
-- Mismo criterio de seguridad que persona_remuneracion: solo admin/personas.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_remuneracion_hito (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id    UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  fecha_inicio  DATE NOT NULL,
  cargo         TEXT,
  monto         NUMERIC(14, 2) NOT NULL,
  moneda        TEXT NOT NULL DEFAULT 'CLP' CHECK (moneda IN ('CLP', 'USD', 'EUR', 'UF')),
  nota          TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remuneracion_hito_persona
  ON persona_remuneracion_hito (persona_id, fecha_inicio DESC);

ALTER TABLE persona_remuneracion_hito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_remuneracion_hito_admin_all ON persona_remuneracion_hito;
CREATE POLICY persona_remuneracion_hito_admin_all ON persona_remuneracion_hito
  FOR ALL
  USING (fn_es_admin())
  WITH CHECK (fn_es_admin());
