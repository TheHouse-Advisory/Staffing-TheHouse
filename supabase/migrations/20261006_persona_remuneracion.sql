-- ──────────────────────────────────────────────────────────────────────────────
-- Remuneraciones por persona (dato sensible).
-- Tabla separada de `persona` para que los select("*") sobre persona no la
-- expongan. RLS: solo roles 'admin' y 'personas' (fn_es_admin) leen/escriben.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS persona_remuneracion (
  persona_id     UUID PRIMARY KEY REFERENCES persona(id) ON DELETE CASCADE,
  sueldo_base    NUMERIC(14, 2),
  bonos          TEXT,
  tipo_contrato  TEXT CHECK (tipo_contrato IN ('Indefinido', 'Plazo fijo', 'Por proyecto', 'Honorarios')),
  moneda         TEXT NOT NULL DEFAULT 'CLP' CHECK (moneda IN ('CLP', 'USD', 'EUR', 'UF')),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE persona_remuneracion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persona_remuneracion_admin_all ON persona_remuneracion;
CREATE POLICY persona_remuneracion_admin_all ON persona_remuneracion
  FOR ALL
  USING (fn_es_admin())
  WITH CHECK (fn_es_admin());
