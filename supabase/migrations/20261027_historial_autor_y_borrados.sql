-- ──────────────────────────────────────────────────────────────────────────────
-- Trazabilidad de asignaciones: quién hizo cada cambio y qué se borró.
--
-- Antes: asignacion_historial registraba creaciones y modificaciones, pero no
-- quién las hizo, y los borrados (incluido el borrado masivo al aprobar un
-- plan) no quedaban registrados en ninguna parte.
--
-- Ahora:
--   · asignacion_historial.actor_id = usuario que hizo el cambio (auth.uid())
--   · tabla nueva asignacion_eliminada_log con una copia de cada asignación
--     borrada y quién la borró (tabla aparte, sin FK, para que el registro
--     sobreviva al borrado)
--   · ambas tablas: solo lectura desde la app; escriben solo los triggers
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Autor en el historial existente (el trigger no envía la columna → usa el default)
ALTER TABLE asignacion_historial
  ADD COLUMN IF NOT EXISTS actor_id uuid DEFAULT auth.uid();

-- 2. Registro de asignaciones eliminadas
CREATE TABLE IF NOT EXISTS asignacion_eliminada_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asignacion_id  uuid,
  persona_id     uuid,
  engagement_id  uuid,
  pct_dedicacion numeric,
  fecha_inicio   date,
  fecha_fin      date,
  estado         text,
  datos          jsonb,                       -- copia completa de la fila borrada
  actor_id       uuid DEFAULT auth.uid(),     -- NULL = servidor / SQL Editor
  eliminado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asignacion_eliminada_log_eliminado_en_idx
  ON asignacion_eliminada_log (eliminado_en DESC);

ALTER TABLE asignacion_eliminada_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asignacion_eliminada_log: lectura" ON asignacion_eliminada_log;
CREATE POLICY "asignacion_eliminada_log: lectura" ON asignacion_eliminada_log
  FOR SELECT TO authenticated USING (fn_tiene_acceso());
-- Sin INSERT/UPDATE/DELETE para usuarios: solo escribe el trigger

CREATE OR REPLACE FUNCTION trg_log_asignacion_eliminada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO asignacion_eliminada_log (
      asignacion_id, persona_id, engagement_id, pct_dedicacion,
      fecha_inicio, fecha_fin, estado, datos
    ) VALUES (
      OLD.id, OLD.persona_id, OLD.engagement_id, OLD.pct_dedicacion,
      OLD.fecha_inicio, OLD.fecha_fin, OLD.estado, to_jsonb(OLD)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Auditoría: si falla, avisa pero no bloquea el borrado
    RAISE WARNING 'trg_log_asignacion_eliminada: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_asignacion_eliminada ON asignacion;
CREATE TRIGGER trg_log_asignacion_eliminada
  AFTER DELETE ON asignacion
  FOR EACH ROW EXECUTE FUNCTION trg_log_asignacion_eliminada();

COMMIT;
