-- Añade ciclo de vida extendido a personas: ex-houser y papelera de reciclaje
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS is_ex_houser BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ DEFAULT NULL;
