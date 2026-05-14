-- Añade campo is_leverager a persona
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS is_leverager BOOLEAN NOT NULL DEFAULT false;
