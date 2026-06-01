-- Ampliar los valores permitidos de rol_sistema para incluir los nuevos roles
ALTER TABLE persona
  DROP CONSTRAINT IF EXISTS persona_rol_sistema_check;

ALTER TABLE persona
  ADD CONSTRAINT persona_rol_sistema_check
  CHECK (rol_sistema IN ('admin', 'GyD', 'AySr', 'Desarrollo', 'proposer'));
