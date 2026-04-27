-- ══════════════════════════════════════════════════════════════════════════════
-- create_propuestas.sql  (v2 — recrea tablas desde cero)
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- Eliminar tablas anteriores incompletas (no tienen datos útiles)
DROP TABLE IF EXISTS asignacion_propuesta CASCADE;
DROP TABLE IF EXISTS propuesta_plan CASCADE;

-- ── 1. propuesta_plan ─────────────────────────────────────────────────────────

CREATE TABLE propuesta_plan (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text        NOT NULL,
  descripcion     text,
  estado          text        NOT NULL DEFAULT 'borrador',
  creada_por      uuid,
  revisado_por    uuid,
  fecha_revision  timestamptz,
  notas_revision  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE propuesta_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planes: acceso total"
  ON propuesta_plan FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 2. asignacion_propuesta ───────────────────────────────────────────────────

CREATE TABLE asignacion_propuesta (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                   uuid        REFERENCES propuesta_plan(id) ON DELETE CASCADE,
  propuesto_por             uuid,
  persona_id                uuid        NOT NULL REFERENCES persona(id)  ON DELETE CASCADE,
  engagement_id             uuid        NOT NULL REFERENCES engagement(id) ON DELETE CASCADE,
  requerimiento_id          uuid        REFERENCES requerimiento_engagement(id) ON DELETE SET NULL,
  pct_dedicacion            numeric     NOT NULL,
  cargo_al_momento          text,
  fecha_inicio              date        NOT NULL,
  fecha_fin                 date        NOT NULL,
  estado                    text        NOT NULL DEFAULT 'borrador',
  tipo                      text        NOT NULL DEFAULT 'asignar',
  asignacion_a_terminar_id  uuid        REFERENCES asignacion(id) ON DELETE SET NULL,
  asignacion_resultante_id  uuid        REFERENCES asignacion(id) ON DELETE SET NULL,
  revisado_por              uuid,
  fecha_revision            timestamptz,
  notas_revision            text,
  notas                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asignacion_propuesta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asig_propuesta: acceso total"
  ON asignacion_propuesta FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_asig_prop_plan    ON asignacion_propuesta(plan_id);
CREATE INDEX idx_asig_prop_persona ON asignacion_propuesta(persona_id);
CREATE INDEX idx_asig_prop_tipo    ON asignacion_propuesta(tipo);
CREATE INDEX idx_asig_prop_estado  ON asignacion_propuesta(estado);
