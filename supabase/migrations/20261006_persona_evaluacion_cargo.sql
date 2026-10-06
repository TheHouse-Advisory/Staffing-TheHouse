-- Cargo de la persona a la fecha de cada evaluación EPP/EDD
ALTER TABLE persona_evaluacion ADD COLUMN IF NOT EXISTS cargo TEXT;
