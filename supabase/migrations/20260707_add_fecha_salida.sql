-- Fecha de salida/desvinculación, requerida para excluir ex-housers
-- de snapshots point-in-time anteriores a su salida.
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS fecha_salida date DEFAULT NULL;
