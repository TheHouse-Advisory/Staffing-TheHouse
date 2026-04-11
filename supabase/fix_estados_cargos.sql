-- ─────────────────────────────────────────────────────────────
--  MIGRACIÓN: Estados engagement + Cargos canónicos
--  Ejecutar en Supabase SQL Editor
--
--  ORDEN CORRECTO:
--  1. Insertar los 8 cargos canónicos en config_cargo PRIMERO
--     (para que la FK persona→config_cargo no falle después)
--  2. Actualizar todas las tablas dependientes
--  3. Eliminar cargos obsoletos de config_cargo
-- ─────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════
--  PASO 1: Insertar los 8 cargos canónicos (si no existen aún)
--  Esto debe ir ANTES de cualquier UPDATE en persona u otras tablas
-- ══════════════════════════════════════════════════════════════
INSERT INTO config_cargo (nombre, presencia_minima_default, excluido_capacidad)
VALUES
  ('Socio',                 0.80, false),
  ('Director de Proyectos', 0.80, false),
  ('Gerente de Proyectos',  0.80, false),
  ('Asociado',              0.75, false),
  ('Consultor Senior',      0.75, false),
  ('Consultor de Proyectos',0.75, false),
  ('Consultor Analista',    0.70, false),
  ('Consultor Trainee',     0.70, false)
ON CONFLICT (nombre) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
--  PASO 2: Actualizar tablas dependientes (ahora la FK se cumple)
-- ══════════════════════════════════════════════════════════════

-- 2a. persona
UPDATE persona SET cargo_actual = 'Director de Proyectos' WHERE cargo_actual = 'Director';
UPDATE persona SET cargo_actual = 'Gerente de Proyectos'  WHERE cargo_actual = 'Gerente';
UPDATE persona SET cargo_actual = 'Consultor de Proyectos' WHERE cargo_actual IN ('Consultor Proyecto','Consultor');
UPDATE persona SET cargo_actual = 'Consultor Analista'    WHERE cargo_actual = 'Analista Senior';
UPDATE persona SET cargo_actual = 'Consultor Trainee'     WHERE cargo_actual IN ('Analista','Practicante');

-- 2b. persona_cargo_historial (no tiene FK a config_cargo, es texto libre — actualizar igual)
UPDATE persona_cargo_historial SET cargo = 'Director de Proyectos' WHERE cargo = 'Director';
UPDATE persona_cargo_historial SET cargo = 'Gerente de Proyectos'  WHERE cargo = 'Gerente';
UPDATE persona_cargo_historial SET cargo = 'Consultor de Proyectos' WHERE cargo IN ('Consultor Proyecto','Consultor');
UPDATE persona_cargo_historial SET cargo = 'Consultor Analista'    WHERE cargo = 'Analista Senior';
UPDATE persona_cargo_historial SET cargo = 'Consultor Trainee'     WHERE cargo IN ('Analista','Practicante');

-- 2c. asignacion
UPDATE asignacion SET cargo_al_momento = 'Director de Proyectos' WHERE cargo_al_momento = 'Director';
UPDATE asignacion SET cargo_al_momento = 'Gerente de Proyectos'  WHERE cargo_al_momento = 'Gerente';
UPDATE asignacion SET cargo_al_momento = 'Consultor de Proyectos' WHERE cargo_al_momento IN ('Consultor Proyecto','Consultor');
UPDATE asignacion SET cargo_al_momento = 'Consultor Analista'    WHERE cargo_al_momento = 'Analista Senior';
UPDATE asignacion SET cargo_al_momento = 'Consultor Trainee'     WHERE cargo_al_momento IN ('Analista','Practicante');

-- 2d. asignacion_propuesta
UPDATE asignacion_propuesta SET cargo_al_momento = 'Director de Proyectos' WHERE cargo_al_momento = 'Director';
UPDATE asignacion_propuesta SET cargo_al_momento = 'Gerente de Proyectos'  WHERE cargo_al_momento = 'Gerente';
UPDATE asignacion_propuesta SET cargo_al_momento = 'Consultor de Proyectos' WHERE cargo_al_momento IN ('Consultor Proyecto','Consultor');
UPDATE asignacion_propuesta SET cargo_al_momento = 'Consultor Analista'    WHERE cargo_al_momento = 'Analista Senior';
UPDATE asignacion_propuesta SET cargo_al_momento = 'Consultor Trainee'     WHERE cargo_al_momento IN ('Analista','Practicante');

-- 2e. requerimiento_engagement
UPDATE requerimiento_engagement SET cargo_requerido = 'Director de Proyectos' WHERE cargo_requerido = 'Director';
UPDATE requerimiento_engagement SET cargo_requerido = 'Gerente de Proyectos'  WHERE cargo_requerido = 'Gerente';
UPDATE requerimiento_engagement SET cargo_requerido = 'Consultor de Proyectos' WHERE cargo_requerido IN ('Consultor Proyecto','Consultor');
UPDATE requerimiento_engagement SET cargo_requerido = 'Consultor Analista'    WHERE cargo_requerido = 'Analista Senior';
UPDATE requerimiento_engagement SET cargo_requerido = 'Consultor Trainee'     WHERE cargo_requerido IN ('Analista','Practicante');

-- ══════════════════════════════════════════════════════════════
--  PASO 3: Eliminar cargos obsoletos de config_cargo
--  (ahora que nadie los referencia)
-- ══════════════════════════════════════════════════════════════
DELETE FROM config_cargo WHERE nombre NOT IN (
  'Socio',
  'Director de Proyectos',
  'Gerente de Proyectos',
  'Asociado',
  'Consultor Senior',
  'Consultor de Proyectos',
  'Consultor Analista',
  'Consultor Trainee'
);

-- ══════════════════════════════════════════════════════════════
--  PASO 4: Engagement estado → solo 'activo' | 'terminado'
-- ══════════════════════════════════════════════════════════════
UPDATE engagement SET estado = 'activo'    WHERE estado IN ('propuesta','pausado');
UPDATE engagement SET estado = 'terminado' WHERE estado = 'rechazado';

ALTER TABLE engagement DROP CONSTRAINT IF EXISTS engagement_estado_check;
ALTER TABLE engagement ADD CONSTRAINT engagement_estado_check
  CHECK (estado IN ('activo','terminado'));

-- ══════════════════════════════════════════════════════════════
--  PASO 5: CASCADE DELETE en engagement
-- ══════════════════════════════════════════════════════════════

-- asignacion → engagement
ALTER TABLE asignacion DROP CONSTRAINT IF EXISTS asignacion_engagement_id_fkey;
ALTER TABLE asignacion ADD CONSTRAINT asignacion_engagement_id_fkey
  FOREIGN KEY (engagement_id) REFERENCES engagement(id) ON DELETE CASCADE;

-- asignacion_propuesta → engagement
ALTER TABLE asignacion_propuesta DROP CONSTRAINT IF EXISTS asignacion_propuesta_engagement_id_fkey;
ALTER TABLE asignacion_propuesta ADD CONSTRAINT asignacion_propuesta_engagement_id_fkey
  FOREIGN KEY (engagement_id) REFERENCES engagement(id) ON DELETE CASCADE;
