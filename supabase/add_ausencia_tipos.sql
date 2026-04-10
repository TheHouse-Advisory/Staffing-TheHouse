-- ══════════════════════════════════════════════════════════════════════════════
-- add_ausencia_tipos.sql  —  Staffing Hub  (v2 — corregido)
-- ══════════════════════════════════════════════════════════════════════════════
-- El campo `tipo` de la tabla `ausencia` es de tipo TEXT (no un enum PostgreSQL).
-- Los valores válidos los controla el frontend vía TypeScript (TipoAusencia).
--
-- Esta migración:
--   1. Verifica que la columna `tipo` acepte los nuevos valores (es TEXT → OK)
--   2. Actualiza/agrega un CHECK CONSTRAINT con todos los tipos válidos
--      (reemplaza el anterior si existía con nombre distinto)
--
-- Nuevos valores añadidos al dominio:
--   • dia_libre           → "Día libre post proyecto"
--   • dia_administrativo  → "Día administrativo"
--
-- CÓMO USAR:
--   Supabase → SQL Editor → New query → pegar → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Eliminar el constraint inline original (viene del CREATE TABLE)
--    y cualquier constraint previo que hayamos agregado
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS ausencia_tipo_check;
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS ausencia_tipo_check1;
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS chk_ausencia_tipo;

-- El CHECK del CREATE TABLE se llama igual que la tabla + columna en Supabase,
-- normalmente "ausencia_tipo_check". Si tiene otro nombre, búscalo con:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'ausencia'::regclass;
-- y reemplaza el nombre arriba.

-- 2. Agregar constraint actualizado con TODOS los tipos válidos
ALTER TABLE ausencia
  ADD CONSTRAINT ausencia_tipo_check CHECK (
    tipo IN (
      'vacaciones',
      'licencia_medica',
      'capacitacion',
      'permiso',
      'dia_libre',
      'dia_administrativo',
      'otro'
    )
  );

-- 3. Verificación — debe mostrar el constraint recién creado
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'ausencia'::regclass
  AND contype = 'c'
ORDER BY conname;
