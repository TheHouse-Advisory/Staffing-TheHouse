-- ⚠️ OBSOLETO: reemplazado por supabase/migrations/. NO EJECUTAR (puede desactivar seguridad o borrar datos).
DO $$ BEGIN RAISE EXCEPTION 'Script obsoleto (supabase/legacy). No ejecutar.'; END $$;

-- Ampliar el check constraint de engagement.tipo para incluir 'ayuda_interna'
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run

ALTER TABLE engagement
  DROP CONSTRAINT IF EXISTS engagement_tipo_check;

ALTER TABLE engagement
  ADD CONSTRAINT engagement_tipo_check
  CHECK (tipo IN ('propuesta', 'proyecto', 'ayuda_interna'));
