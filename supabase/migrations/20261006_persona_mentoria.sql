-- ──────────────────────────────────────────────────────────────────────────────
-- Historial de mentorías por persona. persona.mentor_id sigue siendo el mentor
-- vigente (lo usan otras vistas); esta tabla guarda inicio/fin de cada mentoría.
-- Acceso: solo admin/personas (fn_es_admin).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_mentoria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id    UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  mentor_id     UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  fecha_inicio  DATE,            -- NULL = asignación previa al historial (fecha desconocida)
  fecha_fin     DATE,            -- NULL = mentoría vigente
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_mentoria_persona
  ON persona_mentoria (persona_id, fecha_inicio);

ALTER TABLE persona_mentoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_mentoria_admin_all ON persona_mentoria;
CREATE POLICY persona_mentoria_admin_all ON persona_mentoria
  FOR ALL
  USING (fn_es_admin())
  WITH CHECK (fn_es_admin());

-- Backfill: mentores vigentes actuales como mentoría activa sin fecha de inicio
INSERT INTO persona_mentoria (persona_id, mentor_id, fecha_inicio, fecha_fin)
SELECT p.id, p.mentor_id, NULL, NULL
FROM persona p
WHERE p.mentor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM persona_mentoria m
    WHERE m.persona_id = p.id AND m.fecha_fin IS NULL
  );
