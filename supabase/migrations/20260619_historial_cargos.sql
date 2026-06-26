-- Tabla para registrar la trazabilidad de cargos de cada persona
CREATE TABLE IF NOT EXISTS historial_cargos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  uuid        NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  cargo       text        NOT NULL,
  fecha_inicio date       NOT NULL,
  fecha_fin    date,                         -- NULL = cargo actual en curso
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Índice para búsquedas frecuentes por persona
CREATE INDEX IF NOT EXISTS historial_cargos_persona_idx
  ON historial_cargos (persona_id, fecha_inicio DESC);

-- RLS: mismas reglas que el resto de tablas de la app
ALTER TABLE historial_cargos ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado puede ver el historial
CREATE POLICY "historial_cargos_select"
  ON historial_cargos FOR SELECT
  TO authenticated
  USING (true);

-- Escritura: solo admin y GyD pueden insertar/editar/borrar
CREATE POLICY "historial_cargos_write"
  ON historial_cargos FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM persona
      WHERE persona.id = auth.uid()
        AND persona.rol_sistema IN ('admin', 'GyD')
    )
  );
