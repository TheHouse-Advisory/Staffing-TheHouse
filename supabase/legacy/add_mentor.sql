-- ⚠️ OBSOLETO: reemplazado por supabase/migrations/. NO EJECUTAR (puede desactivar seguridad o borrar datos).
DO $$ BEGIN RAISE EXCEPTION 'Script obsoleto (supabase/legacy). No ejecutar.'; END $$;

-- Agrega relación mentor: cada persona puede tener un mentor (otra persona del equipo)
ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS mentor_id uuid REFERENCES persona(id) ON DELETE SET NULL;
