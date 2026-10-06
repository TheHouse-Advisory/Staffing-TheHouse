-- ──────────────────────────────────────────────────────────────────────────────
-- Evaluaciones de desempeño (EPP / EDD) por persona — línea temporal en
-- Perfil → Desempeño. Acceso: solo admin/personas (fn_es_admin).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_evaluacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'EDD' CHECK (tipo IN ('EPP', 'EDD')),
  fecha       DATE NOT NULL,
  nota        NUMERIC(3, 1) NOT NULL CHECK (nota BETWEEN 1 AND 7),
  comentario  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_evaluacion_persona
  ON persona_evaluacion (persona_id, fecha);

ALTER TABLE persona_evaluacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_evaluacion_admin_all ON persona_evaluacion;
CREATE POLICY persona_evaluacion_admin_all ON persona_evaluacion
  FOR ALL
  USING (fn_es_admin())
  WITH CHECK (fn_es_admin());
