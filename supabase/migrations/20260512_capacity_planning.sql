-- Tabla de planificación de capacidad por persona y semana
CREATE TABLE IF NOT EXISTS capacity_planning (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id    uuid        NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  semana_inicio date        NOT NULL,  -- lunes de la semana ISO (YYYY-MM-DD)
  capacidad     smallint    NOT NULL DEFAULT 1 CHECK (capacidad >= 0 AND capacidad <= 10),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (persona_id, semana_inicio)
);

-- Índice para queries por año
CREATE INDEX IF NOT EXISTS idx_capacity_semana ON capacity_planning (semana_inicio);

-- RLS: mismas reglas que el resto del proyecto
ALTER TABLE capacity_planning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capacity_select" ON capacity_planning FOR SELECT USING (true);
CREATE POLICY "capacity_insert" ON capacity_planning FOR INSERT WITH CHECK (true);
CREATE POLICY "capacity_update" ON capacity_planning FOR UPDATE USING (true);
CREATE POLICY "capacity_delete" ON capacity_planning FOR DELETE USING (true);
