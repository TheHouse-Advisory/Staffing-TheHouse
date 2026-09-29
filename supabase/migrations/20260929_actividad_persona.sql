-- Viajes por persona: engagement_actividades gana persona_id (opcional).
-- NULL = actividad del engagement completo (comportamiento anterior).
ALTER TABLE engagement_actividades
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES persona(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_engagement_actividades_persona_id
  ON engagement_actividades(persona_id);

NOTIFY pgrst, 'reload schema';
