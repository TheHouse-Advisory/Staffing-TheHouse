-- ⚠️ OBSOLETO: reemplazado por supabase/migrations/. NO EJECUTAR (puede desactivar seguridad o borrar datos).
DO $$ BEGIN RAISE EXCEPTION 'Script obsoleto (supabase/legacy). No ejecutar.'; END $$;

-- Agregar columna fecha_nacimiento a la tabla persona
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run

ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
