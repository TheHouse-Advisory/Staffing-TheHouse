-- Orden manual (drag & drop) de personas dentro de su grupo de cargo en la vista de Ausencias
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS orden_ausencias INTEGER;
