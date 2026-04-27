-- ══════════════════════════════════════════════════════════════════════════════
-- create_engagement_capacidades_tematicas.sql
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. engagement_capacidad ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS engagement_capacidad (
  engagement_id  uuid  NOT NULL REFERENCES engagement(id)    ON DELETE CASCADE,
  capacidad_id   uuid  NOT NULL REFERENCES cat_capacidad(id) ON DELETE CASCADE,
  PRIMARY KEY (engagement_id, capacidad_id)
);

ALTER TABLE engagement_capacidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eng_cap: acceso total"
  ON engagement_capacidad FOR ALL
  USING (true) WITH CHECK (true);

-- ── 2. engagement_tematica ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS engagement_tematica (
  engagement_id  uuid  NOT NULL REFERENCES engagement(id)   ON DELETE CASCADE,
  tematica_id    uuid  NOT NULL REFERENCES cat_tematica(id) ON DELETE CASCADE,
  PRIMARY KEY (engagement_id, tematica_id)
);

ALTER TABLE engagement_tematica ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eng_tem: acceso total"
  ON engagement_tematica FOR ALL
  USING (true) WITH CHECK (true);
