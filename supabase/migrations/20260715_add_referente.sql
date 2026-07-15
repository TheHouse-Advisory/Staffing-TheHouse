-- Añade campo referente a persona (visible en el form solo para Director/Gerente/Asociado)
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS referente BOOLEAN NOT NULL DEFAULT false;
