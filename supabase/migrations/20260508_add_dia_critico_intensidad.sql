-- Crea la tabla dia_critico con soporte de rangos e intensidad visual
CREATE TABLE IF NOT EXISTS dia_critico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagement(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL,
  fecha_fin     DATE,
  intensidad    TEXT NOT NULL DEFAULT 'rojo',
  descripcion   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dia_critico_engagement_idx ON dia_critico(engagement_id);
