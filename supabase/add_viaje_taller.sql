-- Agregar columnas tiene_viaje y tiene_taller a la tabla engagement
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run

ALTER TABLE engagement
  ADD COLUMN IF NOT EXISTS tiene_viaje  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiene_taller boolean NOT NULL DEFAULT false;
