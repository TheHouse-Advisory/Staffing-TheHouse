-- ─────────────────────────────────────────────────────────────
--  Migración: nuevos campos para proyectos, personas y evaluaciones
--  Ejecutar en: Supabase Dashboard > SQL Editor
-- ─────────────────────────────────────────────────────────────

-- 1. Nuevos campos en engagement (proyecto)
ALTER TABLE engagement
  ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES cat_tematica(id),
  ADD COLUMN IF NOT EXISTS nivel_dificultad text CHECK (nivel_dificultad IN ('bajo', 'medio', 'alto'));

-- 2. Nuevos campos en persona
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS estado_talento text CHECK (estado_talento IN ('talento', 'en_proceso', 'no_talento')),
  ADD COLUMN IF NOT EXISTS mentor_id uuid REFERENCES persona(id);

-- 3. Evaluaciones EPP (por proyecto)
CREATE TABLE IF NOT EXISTS evaluacion_epp (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  uuid NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  engagement_id uuid REFERENCES engagement(id),
  fecha       date NOT NULL,
  calificacion numeric(3,1) NOT NULL,
  comentario  text,
  created_at  timestamptz DEFAULT now()
);

-- 4. Evaluaciones EDD (desempeño anual)
CREATE TABLE IF NOT EXISTS evaluacion_edd (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  uuid NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  periodo     integer NOT NULL,
  fecha       date NOT NULL,
  calificacion numeric(3,1) NOT NULL,
  comentario  text,
  created_at  timestamptz DEFAULT now()
);

-- 5. RLS
ALTER TABLE evaluacion_epp ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluacion_edd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_auth_epp" ON evaluacion_epp FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "allow_auth_edd" ON evaluacion_edd FOR ALL USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────
--  6. Storage bucket para fotos (requiere ejecutar en Supabase Dashboard
--     > Storage > New Bucket):
--       Nombre: fotos-personas
--       Public: true   ← para que foto_url funcione como URL directa
-- ─────────────────────────────────────────────────────────────
