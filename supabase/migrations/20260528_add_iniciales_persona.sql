-- Agrega columna de iniciales personalizadas a la tabla persona.
-- NULL = usar iniciales automáticas (primer carácter de nombre + apellido).
-- Máximo 3 caracteres para cubrir casos como "SMC" o "JDP".

ALTER TABLE persona
  ADD COLUMN IF NOT EXISTS iniciales VARCHAR(3) DEFAULT NULL;

COMMENT ON COLUMN persona.iniciales IS
  'Iniciales personalizadas para el avatar (máx. 3 caracteres). NULL = auto-calculadas desde nombre + apellido.';
