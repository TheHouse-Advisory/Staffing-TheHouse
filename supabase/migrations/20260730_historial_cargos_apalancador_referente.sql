-- Traslada la trazabilidad de Apalancador/Referente desde un switch global en `persona`
-- a un switch por periodo dentro de `historial_cargos`.
ALTER TABLE historial_cargos
  ADD COLUMN IF NOT EXISTS es_apalancador boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS es_referente   boolean NOT NULL DEFAULT false;
