-- ══════════════════════════════════════════════════════════════════════════════
-- add_tipo_ausencia_table.sql — Staffing Hub
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Crea tabla `tipo_ausencia` para gestión dinámica de tipos
-- 2. Inserta los 7 tipos existentes con sus colores
-- 3. Elimina el CHECK CONSTRAINT fijo en `ausencia.tipo`
--    (la validación pasa a controlarse desde el frontend + FK opcional)
--
-- CÓMO USAR:
--   Supabase → SQL Editor → New query → pegar → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Crear tabla
CREATE TABLE IF NOT EXISTS tipo_ausencia (
  id          TEXT PRIMARY KEY,          -- slug, ej: "vacaciones_confirmadas"
  label       TEXT NOT NULL,             -- nombre visible
  color_bg    TEXT NOT NULL DEFAULT '#9ca3af',
  color_text  TEXT NOT NULL DEFAULT '#fff',
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Seed con los tipos actuales
INSERT INTO tipo_ausencia (id, label, color_bg, color_text) VALUES
  ('vacaciones_confirmadas',   'Vacaciones confirmadas',        '#38bdf8', '#fff'),
  ('vacaciones_por_confirmar', 'Vacaciones por confirmar',      '#fbbf24', '#fff'),
  ('permiso_sin_goce',         'Permiso sin goce de sueldo',    '#92400e', '#fff'),
  ('dia_post_proyecto',        'Día post proyecto',             '#f97316', '#fff'),
  ('dia_beneficio',            'Día beneficio',                 '#a855f7', '#fff'),
  ('dia_administrativo',       'Día administrativo',            '#22c55e', '#fff'),
  ('otro',                     'Otro',                          '#9ca3af', '#fff')
ON CONFLICT (id) DO NOTHING;

-- 3. Eliminar CHECK constraint fijo (los valores los controla ahora la tabla)
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS ausencia_tipo_check;
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS ausencia_tipo_check1;
ALTER TABLE ausencia DROP CONSTRAINT IF EXISTS chk_ausencia_tipo;

-- 4. RLS: lectura pública (autenticados), escritura solo autenticados
ALTER TABLE tipo_ausencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tipo_ausencia_select" ON tipo_ausencia
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tipo_ausencia_insert" ON tipo_ausencia
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "tipo_ausencia_delete" ON tipo_ausencia
  FOR DELETE TO authenticated USING (true);

-- 5. Verificación
SELECT id, label FROM tipo_ausencia ORDER BY created_at;
