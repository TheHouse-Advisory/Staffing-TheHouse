-- ──────────────────────────────────────────────────────────────────────────────
-- Alertas: dos correcciones
--
-- 1. "Planes de acción" se activaba con cualquier edición del proyecto (usaba
--    updated_at). Ahora hay una fecha propia: escalado_a_proyecto_en, que se
--    llena sola cuando un engagement se crea como "proyecto" o pasa a serlo.
--
-- 2. "Marcar como revisada" se guardaba solo en el navegador de cada persona:
--    el resto del equipo no lo veía y se perdía al cambiar de computador (y la
--    alerta de 20 días hábiles reaparecía a los 30 días). Ahora se guarda en la
--    tabla compartida alerta_revisada.
--
-- Ejecutar en Supabase → SQL Editor (idempotente) ANTES de desplegar el código.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Fecha de escalado a proyecto ─────────────────────────────────────────
ALTER TABLE engagement ADD COLUMN IF NOT EXISTS escalado_a_proyecto_en timestamptz;

-- Proyectos existentes: se toma su fecha de creación (no disparan alertas viejas)
UPDATE engagement
SET escalado_a_proyecto_en = created_at
WHERE tipo = 'proyecto' AND escalado_a_proyecto_en IS NULL;

CREATE OR REPLACE FUNCTION trg_engagement_escalado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo modifica la fila que se está guardando (no escribe en otras tablas)
  IF NEW.tipo = 'proyecto'
     AND (TG_OP = 'INSERT' OR OLD.tipo IS DISTINCT FROM 'proyecto') THEN
    NEW.escalado_a_proyecto_en := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engagement_escalado ON engagement;
CREATE TRIGGER trg_engagement_escalado
  BEFORE INSERT OR UPDATE OF tipo ON engagement
  FOR EACH ROW EXECUTE FUNCTION trg_engagement_escalado();

-- ── 2. Alertas revisadas (compartidas por el equipo) ────────────────────────
CREATE TABLE IF NOT EXISTS alerta_revisada (
  alerta_id     text PRIMARY KEY,
  tipo          text NOT NULL,
  descripcion   text NOT NULL,
  revisada_en   timestamptz NOT NULL DEFAULT now(),
  revisada_por  uuid REFERENCES persona(id) ON DELETE SET NULL DEFAULT fn_persona_actual_id()
);

ALTER TABLE alerta_revisada ENABLE ROW LEVEL SECURITY;

-- Leer: cualquier usuario con acceso vigente
DROP POLICY IF EXISTS "alerta_revisada: leer" ON alerta_revisada;
CREATE POLICY "alerta_revisada: leer" ON alerta_revisada
  FOR SELECT USING (fn_tiene_acceso());

-- Marcar / desmarcar: los roles que ven la pestaña Alertas (admin, personas, proposer)
DROP POLICY IF EXISTS "alerta_revisada: marcar" ON alerta_revisada;
CREATE POLICY "alerta_revisada: marcar" ON alerta_revisada
  FOR INSERT WITH CHECK (fn_puede_aprobar_plan());

DROP POLICY IF EXISTS "alerta_revisada: desmarcar" ON alerta_revisada;
CREATE POLICY "alerta_revisada: desmarcar" ON alerta_revisada
  FOR DELETE USING (fn_puede_aprobar_plan());

COMMIT;

-- Verificación: debe devolver la columna nueva y la tabla
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'engagement' AND column_name = 'escalado_a_proyecto_en') AS columna_escalado,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'alerta_revisada') AS tabla_revisadas;
