-- Corrige la política de escritura en historial_cargos.
-- La versión anterior comparaba persona.id = auth.uid() (incorrecto).
-- El vínculo correcto es persona.auth_user_id = auth.uid().

DROP POLICY IF EXISTS "historial_cargos_write" ON historial_cargos;

CREATE POLICY "historial_cargos_write"
  ON historial_cargos FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM persona
      WHERE persona.auth_user_id = auth.uid()
        AND persona.rol_sistema IN ('admin', 'GyD')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM persona
      WHERE persona.auth_user_id = auth.uid()
        AND persona.rol_sistema IN ('admin', 'GyD')
    )
  );
