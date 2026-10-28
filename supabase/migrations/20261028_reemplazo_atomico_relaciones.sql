-- ──────────────────────────────────────────────────────────────────────────────
-- Reemplazo atómico de relaciones (borrar + reinsertar en una sola transacción).
--
-- Antes: EngagementForm y PersonaForm borraban capacidades/temáticas/actividades
-- (o industrias/capacidades/temáticas/historial de cargos) y luego reinsertaban
-- desde el navegador. Si el insert fallaba, el borrado ya estaba hecho y los
-- datos se perdían.
--
-- Ahora cada función hace todo dentro de una transacción: si cualquier paso
-- falla, Postgres revierte también el borrado.
--
-- SECURITY INVOKER: corre con los permisos del usuario que llama, así que
-- aplican exactamente las mismas políticas RLS que las escrituras directas.
-- Ejecutar en Supabase → SQL Editor (idempotente) ANTES de desplegar el código.
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Engagement: capacidades, temáticas y actividades (viajes/talleres)
CREATE OR REPLACE FUNCTION reemplazar_relaciones_engagement(
  p_engagement_id uuid,
  p_capacidades   uuid[],
  p_tematicas     uuid[],
  p_actividades   jsonb   -- [{tipo, titulo, descripcion, fecha_inicio, fecha_fin}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM engagement_capacidad   WHERE engagement_id = p_engagement_id;
  DELETE FROM engagement_tematica    WHERE engagement_id = p_engagement_id;
  DELETE FROM engagement_actividades WHERE engagement_id = p_engagement_id;

  INSERT INTO engagement_capacidad (engagement_id, capacidad_id)
  SELECT p_engagement_id, c FROM unnest(coalesce(p_capacidades, '{}')) AS c;

  INSERT INTO engagement_tematica (engagement_id, tematica_id)
  SELECT p_engagement_id, t FROM unnest(coalesce(p_tematicas, '{}')) AS t;

  -- jsonb_populate_recordset castea cada campo al tipo real de la columna
  INSERT INTO engagement_actividades (engagement_id, tipo, titulo, descripcion, fecha_inicio, fecha_fin)
  SELECT p_engagement_id, a.tipo, a.titulo, a.descripcion, a.fecha_inicio, a.fecha_fin
  FROM jsonb_populate_recordset(NULL::engagement_actividades, coalesce(p_actividades, '[]'::jsonb)) AS a;
END;
$$;

-- 2. Persona: historial de cargos, industrias, capacidades y temáticas
CREATE OR REPLACE FUNCTION reemplazar_relaciones_persona(
  p_persona_id  uuid,
  p_cargos      jsonb,  -- [{cargo, fecha_inicio, fecha_fin, es_apalancador, es_referente}]
  p_industrias  uuid[],
  p_capacidades uuid[],
  p_tematicas   uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM historial_cargos  WHERE persona_id = p_persona_id;
  DELETE FROM persona_industria WHERE persona_id = p_persona_id;
  DELETE FROM persona_capacidad WHERE persona_id = p_persona_id;
  DELETE FROM persona_tematica  WHERE persona_id = p_persona_id;

  INSERT INTO historial_cargos (persona_id, cargo, fecha_inicio, fecha_fin, es_apalancador, es_referente)
  SELECT p_persona_id, h.cargo, h.fecha_inicio, h.fecha_fin, h.es_apalancador, h.es_referente
  FROM jsonb_populate_recordset(NULL::historial_cargos, coalesce(p_cargos, '[]'::jsonb)) AS h;

  INSERT INTO persona_industria (persona_id, industria_id)
  SELECT p_persona_id, i FROM unnest(coalesce(p_industrias, '{}')) AS i;

  INSERT INTO persona_capacidad (persona_id, capacidad_id)
  SELECT p_persona_id, c FROM unnest(coalesce(p_capacidades, '{}')) AS c;

  INSERT INTO persona_tematica (persona_id, tematica_id)
  SELECT p_persona_id, t FROM unnest(coalesce(p_tematicas, '{}')) AS t;
END;
$$;

-- Solo usuarios autenticados de la app
REVOKE EXECUTE ON FUNCTION reemplazar_relaciones_engagement(uuid, uuid[], uuid[], jsonb)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION reemplazar_relaciones_persona(uuid, jsonb, uuid[], uuid[], uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION reemplazar_relaciones_engagement(uuid, uuid[], uuid[], jsonb)      TO authenticated;
GRANT  EXECUTE ON FUNCTION reemplazar_relaciones_persona(uuid, jsonb, uuid[], uuid[], uuid[]) TO authenticated;
