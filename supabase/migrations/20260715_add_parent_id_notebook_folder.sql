-- Soporte de carpetas anidadas en el Notebook: auto-referencia padre/hijo

ALTER TABLE notebook_folder
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES notebook_folder(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notebook_folder_parent ON notebook_folder(parent_id);
