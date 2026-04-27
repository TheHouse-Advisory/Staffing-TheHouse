-- Agregar columna fecha_nacimiento a la tabla persona
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run

ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
