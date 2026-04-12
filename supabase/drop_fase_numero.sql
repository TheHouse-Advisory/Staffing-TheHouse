-- ================================================================
-- Migración: eliminar fase_numero del modelo de datos
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ================================================================

-- 1. Eliminar columna fase_numero (CASCADE elimina la vista dependiente automáticamente)
ALTER TABLE requerimiento_engagement DROP COLUMN IF EXISTS fase_numero CASCADE;

-- 2. Recrear la vista cobertura_engagement sin fase_numero
--    (el CASCADE del paso anterior ya la eliminó, solo hay que crearla)
DROP VIEW IF EXISTS cobertura_engagement;

CREATE VIEW cobertura_engagement AS
SELECT
  e.id              AS engagement_id,
  e.nombre          AS engagement_nombre,
  e.cliente,
  e.estado          AS engagement_estado,
  r.id              AS requerimiento_id,
  r.fase_nombre,
  r.cargo_requerido,
  r.pct_dedicacion  AS pct_requerido,
  r.fecha_inicio    AS req_fecha_inicio,
  r.fecha_fin       AS req_fecha_fin,
  COALESCE(SUM(a.pct_dedicacion), 0)                                        AS pct_cubierto,
  GREATEST(0, r.pct_dedicacion - COALESCE(SUM(a.pct_dedicacion), 0))        AS pct_descubierto
FROM requerimiento_engagement r
JOIN engagement e ON e.id = r.engagement_id
LEFT JOIN asignacion a
  ON  a.requerimiento_id = r.id
  AND a.estado = 'activa'
GROUP BY
  e.id, e.nombre, e.cliente, e.estado,
  r.id, r.fase_nombre, r.cargo_requerido,
  r.pct_dedicacion, r.fecha_inicio, r.fecha_fin;
