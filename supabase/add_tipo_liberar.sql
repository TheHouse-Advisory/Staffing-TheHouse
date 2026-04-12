-- ================================================================
-- Migración: soporte para liberaciones (terminar asignación)
-- dentro de un plan propuesto.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ================================================================

-- 1. Tipo de propuesta: 'asignar' (default) o 'liberar'
ALTER TABLE asignacion_propuesta
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'asignar';

-- 2. FK opcional a la asignación real que se propone terminar
ALTER TABLE asignacion_propuesta
  ADD COLUMN IF NOT EXISTS asignacion_a_terminar_id uuid
    REFERENCES asignacion(id) ON DELETE SET NULL;

-- 3. Índice para búsquedas por tipo
CREATE INDEX IF NOT EXISTS idx_asig_prop_tipo
  ON asignacion_propuesta(tipo);
