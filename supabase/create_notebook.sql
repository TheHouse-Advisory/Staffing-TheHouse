-- create_notebook.sql
-- Módulo Notebook: bitácora personal por colaborador

CREATE TABLE IF NOT EXISTS notebook_folder (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  creado_en   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebook_note (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     UUID NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  folder_id      UUID REFERENCES notebook_folder(id) ON DELETE SET NULL,
  titulo         TEXT NOT NULL DEFAULT 'Sin título',
  contenido      TEXT DEFAULT '',
  creado_en      TIMESTAMPTZ DEFAULT now(),
  actualizado_en TIMESTAMPTZ DEFAULT now()
);

-- Índices de consulta frecuente
CREATE INDEX IF NOT EXISTS idx_notebook_folder_persona ON notebook_folder(persona_id);
CREATE INDEX IF NOT EXISTS idx_notebook_note_persona   ON notebook_note(persona_id);
CREATE INDEX IF NOT EXISTS idx_notebook_note_folder    ON notebook_note(folder_id);

-- RLS
ALTER TABLE notebook_folder ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebook_note   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notebook_folder_all" ON notebook_folder FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "notebook_note_all"   ON notebook_note   FOR ALL USING (true) WITH CHECK (true);
