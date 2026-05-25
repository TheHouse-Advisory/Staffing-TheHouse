-- ─────────────────────────────────────────────────────────────
--  Módulo Actividades para Engagements
--  Tipos: 'Viajes' | 'Taller'
-- ─────────────────────────────────────────────────────────────

-- 1. Enum de tipos de actividad
CREATE TYPE actividad_tipo AS ENUM ('Viajes', 'Taller');

-- 2. Tabla principal
CREATE TABLE engagement_actividades (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid        NOT NULL REFERENCES engagement(id) ON DELETE CASCADE,
  tipo           actividad_tipo NOT NULL,
  titulo         text        NOT NULL,
  descripcion    text,
  fecha_inicio   date        NOT NULL,
  fecha_fin      date        NOT NULL,
  creado_en      timestamptz DEFAULT now(),
  actualizado_en timestamptz DEFAULT now()
);

-- Índice para queries frecuentes por engagement
CREATE INDEX idx_engagement_actividades_engagement_id
  ON engagement_actividades(engagement_id);

-- 3. Row Level Security
ALTER TABLE engagement_actividades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "actividades_select" ON engagement_actividades
  FOR SELECT USING (true);

CREATE POLICY "actividades_insert" ON engagement_actividades
  FOR INSERT WITH CHECK (true);

CREATE POLICY "actividades_update" ON engagement_actividades
  FOR UPDATE USING (true);

CREATE POLICY "actividades_delete" ON engagement_actividades
  FOR DELETE USING (true);

-- 4. Trigger para actualizar 'actualizado_en' en cada UPDATE
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_actividades_actualizado_en
  BEFORE UPDATE ON engagement_actividades
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();
