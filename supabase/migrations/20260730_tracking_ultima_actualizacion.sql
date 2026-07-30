-- Tracking de autor por cambio: agrega updated_by (auth.uid()) capturado automáticamente
-- vía trigger en cada INSERT/UPDATE, para poder calcular una "última actualización" real
-- (dato modificado en la base) excluyendo cambios sin sesión (scripts/SQL directo) y de
-- personas específicas (ej. cuentas de prueba/admin) cuando corresponda.

ALTER TABLE engagement                 ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE asignacion                 ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE ausencia                   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ausencia                   ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE requerimiento_engagement   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE requerimiento_engagement   ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE historial_cargos           ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE historial_cargos           ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE engagement_actividades     ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Trigger genérico: stampa updated_at/updated_by con el usuario autenticado de la request.
-- auth.uid() es NULL cuando la escritura no viene de una sesión de la app (ej. SQL directo
-- via service role) — eso es justamente lo que permite excluir esos cambios más abajo.
CREATE OR REPLACE FUNCTION set_updated_meta()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- engagement_actividades usa "actualizado_en" (no "updated_at") como nombre de columna existente.
CREATE OR REPLACE FUNCTION set_updated_meta_actividades()
RETURNS trigger AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_engagement_updated_meta ON engagement;
CREATE TRIGGER trg_engagement_updated_meta
  BEFORE INSERT OR UPDATE ON engagement
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta();

DROP TRIGGER IF EXISTS trg_asignacion_updated_meta ON asignacion;
CREATE TRIGGER trg_asignacion_updated_meta
  BEFORE INSERT OR UPDATE ON asignacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta();

DROP TRIGGER IF EXISTS trg_ausencia_updated_meta ON ausencia;
CREATE TRIGGER trg_ausencia_updated_meta
  BEFORE INSERT OR UPDATE ON ausencia
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta();

DROP TRIGGER IF EXISTS trg_requerimiento_engagement_updated_meta ON requerimiento_engagement;
CREATE TRIGGER trg_requerimiento_engagement_updated_meta
  BEFORE INSERT OR UPDATE ON requerimiento_engagement
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta();

DROP TRIGGER IF EXISTS trg_historial_cargos_updated_meta ON historial_cargos;
CREATE TRIGGER trg_historial_cargos_updated_meta
  BEFORE INSERT OR UPDATE ON historial_cargos
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta();

DROP TRIGGER IF EXISTS trg_engagement_actividades_updated_meta ON engagement_actividades;
CREATE TRIGGER trg_engagement_actividades_updated_meta
  BEFORE INSERT OR UPDATE ON engagement_actividades
  FOR EACH ROW EXECUTE FUNCTION set_updated_meta_actividades();

-- RPC: última fecha real de modificación de datos del Tablero.
-- Prioriza cambios "filtrados" (con sesión, y no del perfil excluido); si todavía no hay
-- ninguno (ej. recién aplicada la migración), cae a la última fecha real sin filtrar
-- para no dejar el badge vacío mientras se acumulan cambios trackeados.
CREATE OR REPLACE FUNCTION ultima_actualizacion_real(excluir_uid uuid DEFAULT '96f15809-3476-4361-9765-d80dec5e094e')
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT MAX(t) FROM (
      SELECT MAX(updated_at) AS t FROM engagement               WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
      UNION ALL
      SELECT MAX(updated_at)    FROM asignacion                 WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
      UNION ALL
      SELECT MAX(updated_at)    FROM ausencia                   WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
      UNION ALL
      SELECT MAX(updated_at)    FROM requerimiento_engagement   WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
      UNION ALL
      SELECT MAX(updated_at)    FROM historial_cargos           WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
      UNION ALL
      SELECT MAX(actualizado_en) FROM engagement_actividades    WHERE updated_by IS NOT NULL AND updated_by <> excluir_uid
    ) sub_filtrado),
    (SELECT MAX(t) FROM (
      SELECT MAX(updated_at) AS t FROM engagement
      UNION ALL
      SELECT MAX(updated_at)    FROM asignacion
      UNION ALL
      SELECT MAX(updated_at)    FROM ausencia
      UNION ALL
      SELECT MAX(updated_at)    FROM requerimiento_engagement
      UNION ALL
      SELECT MAX(updated_at)    FROM historial_cargos
      UNION ALL
      SELECT MAX(actualizado_en) FROM engagement_actividades
    ) sub_sin_filtrar)
  );
$$;

GRANT EXECUTE ON FUNCTION ultima_actualizacion_real(uuid) TO authenticated, anon;
