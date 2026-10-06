-- ──────────────────────────────────────────────────────────────────────────────
-- Historial de la Matriz de Talento (9-box) por persona.
-- cuadrante: índice 0-8 de la cuadrícula (fila 0 = alto potencial; col 0 = bajo
-- desempeño), igual que BOXES en components/personas/TalentMatrix.tsx.
-- Acceso: solo admin/personas (fn_es_admin).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_matriz_hito (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  cargo       TEXT,
  cuadrante   SMALLINT NOT NULL CHECK (cuadrante BETWEEN 0 AND 8),
  comentario  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_matriz_hito_persona
  ON persona_matriz_hito (persona_id, fecha);

ALTER TABLE persona_matriz_hito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_matriz_hito_admin_all ON persona_matriz_hito;
CREATE POLICY persona_matriz_hito_admin_all ON persona_matriz_hito
  FOR ALL
  USING (fn_es_admin())
  WITH CHECK (fn_es_admin());
